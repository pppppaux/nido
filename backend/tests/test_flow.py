from fastapi.testclient import TestClient

from nido.categories import guess_from_keywords
from nido.house import settle_up, split_cents
from nido.main import app


def balance_of(client, user_id):
    money = client.get("/api/money").json()
    return {b["user_id"]: b["balance_cents"] for b in money["balances"]}[user_id]


def test_register_needs_the_house_code():
    client = TestClient(app)
    res = client.post(
        "/api/auth/register",
        json={"invite_code": "otro", "username": "x", "display_name": "X", "password": "contraseña1"},
    )
    assert res.status_code == 403
    assert client.get("/api/items").status_code == 401


def test_password_change_closes_other_sessions(trio):
    ana, _, _ = trio
    other = TestClient(app)
    token = other.post("/api/auth/login", json={"username": "ana", "password": "contraseña1"}).json()["token"]
    other.headers["Authorization"] = f"Bearer {token}"
    assert other.get("/api/auth/me").status_code == 200
    res = ana.post("/api/auth/password", json={"current": "contraseña1", "new": "nueva-contraseña"})
    assert res.status_code == 200
    ana.headers["Authorization"] = f"Bearer {res.json()['token']}"
    assert ana.get("/api/auth/me").status_code == 200
    assert other.get("/api/auth/me").status_code == 401


def test_common_purchase_is_split_between_everyone(trio):
    ana, bea, carlos = trio
    item = ana.post("/api/items", json={"name": "Papel higiénico"}).json()["item"]
    assert item["category"] == "bano"
    assert item["owner_id"] is None
    bought = bea.post(f"/api/items/{item['id']}/buy", json={"price_cents": 400}).json()
    assert bought["bought_by"] == bea.user["id"]
    # 4,00 € entre tres: 1,34 + 1,33 + 1,33. Bea puso 4 y le tocan 1,34 (id más bajo
    # se lleva el céntimo suelto: Ana).
    assert balance_of(ana, ana.user["id"]) == -134
    assert balance_of(ana, bea.user["id"]) == 400 - 133
    assert balance_of(ana, carlos.user["id"]) == -133


def test_personal_item_bought_by_someone_else(trio):
    ana, bea, _ = trio
    item = ana.post("/api/items", json={"name": "Yogur de coco", "owner_id": ana.user["id"]}).json()["item"]
    bea.post(f"/api/items/{item['id']}/buy", json={"price_cents": 250})
    assert balance_of(ana, ana.user["id"]) == -250
    assert balance_of(ana, bea.user["id"]) == 250
    money = ana.get("/api/money").json()
    assert money["transfers"] == [{"from": ana.user["id"], "to": bea.user["id"], "amount_cents": 250}]
    # Deshacer la compra deshace también la deuda.
    bea.post(f"/api/items/{item['id']}/unbuy")
    assert balance_of(ana, ana.user["id"]) == 0


def test_own_item_does_not_touch_the_accounts(trio):
    ana, _, _ = trio
    item = ana.post("/api/items", json={"name": "Café", "owner_id": ana.user["id"]}).json()["item"]
    bought = ana.post(f"/api/items/{item['id']}/buy", json={"price_cents": 500}).json()
    assert bought["price_cents"] == 500
    assert ana.get("/api/money").json()["expenses"] == []


def test_duplicates_are_merged(trio):
    ana, bea, _ = trio
    first = ana.post("/api/items", json={"name": "Leche"}).json()
    second = bea.post("/api/items", json={"name": "leche", "urgent": True}).json()
    assert second["duplicate"] is True
    assert second["item"]["id"] == first["item"]["id"]
    assert second["item"]["urgent"] is True
    assert len(ana.get("/api/items").json()["pending"]) == 1


def test_pantry_running_out_goes_to_the_list_and_back(trio):
    ana, bea, _ = trio
    entry = ana.post("/api/pantry", json={"name": "Aceite"}).json()
    assert entry["category"] == "despensa"
    ana.patch(f"/api/pantry/{entry['id']}", json={"level": "out"})
    pending = ana.get("/api/items").json()["pending"]
    assert [(i["name"], i["urgent"]) for i in pending] == [("Aceite", True)]
    bea.post(f"/api/items/{pending[0]['id']}/buy", json={})
    assert ana.get("/api/pantry").json()[0]["level"] == "ok"


def test_pantry_back_to_ok_removes_the_auto_item(trio):
    ana, _, _ = trio
    entry = ana.post("/api/pantry", json={"name": "Sal", "level": "low"}).json()
    assert len(ana.get("/api/items").json()["pending"]) == 1
    ana.patch(f"/api/pantry/{entry['id']}", json={"level": "ok"})
    assert ana.get("/api/items").json()["pending"] == []


def test_settlement_clears_the_debt(trio):
    ana, bea, carlos = trio
    res = ana.post("/api/expenses", json={"description": "Internet", "amount_cents": 3000, "paid_by": ana.user["id"]})
    assert res.status_code == 200
    assert balance_of(ana, ana.user["id"]) == 2000
    bea.post("/api/settlements", json={"from_user_id": bea.user["id"], "to_user_id": ana.user["id"], "amount_cents": 1000})
    carlos.post("/api/settlements", json={"from_user_id": carlos.user["id"], "to_user_id": ana.user["id"], "amount_cents": 1000})
    money = ana.get("/api/money").json()
    assert all(b["balance_cents"] == 0 for b in money["balances"])
    assert money["transfers"] == []


def test_pulse_moves_on_every_change(trio):
    ana, _, _ = trio
    before = ana.get("/api/pulse").json()["v"]
    ana.post("/api/items", json={"name": "Pan"})
    assert ana.get("/api/pulse").json()["v"] > before


def test_helpers():
    assert split_cents(100, [3, 1, 2]) == {1: 34, 2: 33, 3: 33}
    assert sum(t["amount_cents"] for t in settle_up({1: 500, 2: -200, 3: -300})) == 500
    assert guess_from_keywords("Tomate frito") == "despensa"
    assert guess_from_keywords("Tomates") == "fresco"
    assert guess_from_keywords("Turrón") == "otros"
    assert guess_from_keywords("Papel de cocina") == "limpieza"


def test_urgent_items_notify_everyone_else(trio, monkeypatch):
    from cryptography.hazmat.primitives.asymmetric import ec
    import base64

    from nido import push
    from nido.settings import settings

    raw = ec.generate_private_key(ec.SECP256R1()).private_numbers().private_value.to_bytes(32, "big")
    monkeypatch.setattr(settings, "vapid_private_key", base64.urlsafe_b64encode(raw).rstrip(b"=").decode())
    push._vapid.cache_clear()
    sent = []
    # El último que se suscribe "no existe ya": el servicio de push contestaría 410.
    monkeypatch.setattr(push, "_send", lambda sub, payload: sent.append((sub["user_id"], payload)) or sub["endpoint"] != "https://push/carlos")

    ana, bea, carlos = trio
    assert len(ana.get("/api/push/key").json()["key"]) == 87
    for client, name in ((ana, "ana"), (bea, "bea"), (carlos, "carlos")):
        res = client.post("/api/push/subscribe", json={"endpoint": f"https://push/{name}", "keys": {"p256dh": "k", "auth": "a"}})
        assert res.status_code == 200

    ana.post("/api/items", json={"name": "Leche"})
    assert sent == []

    ana.post("/api/items", json={"name": "Papel higiénico", "urgent": True})
    assert sorted(uid for uid, _ in sent) == [bea.user["id"], carlos.user["id"]]
    assert sent[0][1]["title"] == "Papel higiénico"
    assert sent[0][1]["body"] == "Ana lo ha apuntado como urgente"

    # La suscripción caducada de Carlos se ha borrado: el siguiente aviso solo va a Bea.
    sent.clear()
    item = bea.post("/api/items", json={"name": "Leche", "urgent": True}).json()["item"]
    assert [uid for uid, _ in sent] == [ana.user["id"]]

    # Marcarlo urgente otra vez no vuelve a avisar; quitarle la prisa y ponérsela, sí.
    sent.clear()
    bea.patch(f"/api/items/{item['id']}", json={"urgent": True})
    assert sent == []
    bea.patch(f"/api/items/{item['id']}", json={"urgent": False})
    bea.patch(f"/api/items/{item['id']}", json={"urgent": True})
    assert [uid for uid, _ in sent] == [ana.user["id"]]

    sent.clear()
    entry = carlos.post("/api/pantry", json={"name": "Aceite"}).json()
    carlos.patch(f"/api/pantry/{entry['id']}", json={"level": "low"})
    assert sent == []
    carlos.patch(f"/api/pantry/{entry['id']}", json={"level": "out"})
    assert sorted(uid for uid, _ in sent) == [ana.user["id"], bea.user["id"]]
    assert sent[0][1]["body"] == "Carlos avisa de que se ha acabado"
    push._vapid.cache_clear()


def test_name_cannot_be_changed_from_the_app(trio):
    ana, _, _ = trio
    res = ana.patch("/api/auth/me", json={"display_name": "Otra", "color": "#2F9E44"})
    assert res.status_code == 422
    res = ana.patch("/api/auth/me", json={"color": "#2F9E44"})
    assert res.status_code == 200
    assert res.json()["display_name"] == "Ana"
    assert res.json()["color"] == "#2F9E44"


def test_closed_registration(trio, monkeypatch):
    from nido.settings import settings

    ana, _, _ = trio
    monkeypatch.setattr(settings, "registration_open", False)
    assert TestClient(app).get("/api/auth/options").json() == {"registration_open": False}
    res = TestClient(app).post(
        "/api/auth/register",
        json={"invite_code": "codigo", "username": "dani", "display_name": "Dani", "password": "contraseña1"},
    )
    assert res.status_code == 403
    house = ana.get("/api/house").json()
    assert house["registration_open"] is False and house["invite_code"] is None
    # Los que ya están siguen entrando.
    assert TestClient(app).post("/api/auth/login", json={"username": "ana", "password": "contraseña1"}).status_code == 200
