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


def test_receipt_is_read_then_confirmed_after_review(trio, monkeypatch):
    import json as _json

    from nido import ai
    from nido.settings import settings

    ana, bea, carlos = trio
    leche = ana.post("/api/items", json={"name": "Leche"}).json()["item"]
    yogur = bea.post("/api/items", json={"name": "Yogur de coco", "owner_id": bea.user["id"]}).json()["item"]
    entry = ana.post("/api/pantry", json={"name": "Papel higiénico", "level": "out"}).json()

    monkeypatch.setattr(settings, "do_api_key", "k")
    monkeypatch.setattr(settings, "do_model", "m")
    seen = {}

    def fake(prompt, media_type, data):
        seen["prompt"] = prompt
        return "Aquí está:\n```json\n" + _json.dumps({
            "store": "Mercadona", "date": "2026-10-26", "total": 9.40,
            "lines": [
                {"name": "leche semidesnatada", "qty": "6 ud", "price": 5.34, "match": leche["id"]},
                {"name": "Yogur de coco", "price": "1,99", "match": yogur["id"]},
                {"name": "Chocolate", "price": 2.07, "match": 99999},
                {"name": "Descuento", "price": -0.5, "match": None},
            ],
        }) + "\n```"

    monkeypatch.setattr(ai, "_complete_with_image", fake)
    res = carlos.post("/api/receipts/read", files={"photo": ("t.jpg", b"fake", "image/jpeg")})
    assert res.status_code == 200, res.text
    draft = res.json()
    assert f"{leche['id']}: Leche" in seen["prompt"]
    assert draft["store"] == "Mercadona" and draft["total_cents"] == 940
    # Un id que no está en la lista no se casa con nada, y el descuento suelto no entra.
    assert [(l["name"], l["price_cents"], l["item_id"]) for l in draft["lines"]] == [
        ("Leche semidesnatada", 534, leche["id"]),
        ("Yogur de coco", 199, yogur["id"]),
        ("Chocolate", 207, None),
    ]
    assert draft["lines"][1]["owner_id"] == bea.user["id"]
    # Leer no guarda nada.
    assert len(carlos.get("/api/items").json()["pending"]) == 3

    # Carlos quita el chocolate (es suyo) y añade el papel, que la IA no casó.
    lines = draft["lines"][:2] + [{"name": "Papel higiénico", "price_cents": 300, "item_id": None, "owner_id": None}]
    res = carlos.post("/api/receipts/confirm", json={"store": draft["store"], "lines": lines})
    assert res.status_code == 200, res.text
    # El papel no venía casado, pero estaba pendiente con el mismo nombre: es ese.
    assert res.json() == {"count": 3, "matched": 3, "total_cents": 1033}

    items = carlos.get("/api/items").json()
    assert items["pending"] == []
    assert {i["name"] for i in items["bought"]} == {"Leche", "Yogur de coco", "Papel higiénico"}
    assert all(i["bought_by"] == carlos.user["id"] for i in items["bought"])
    pantry = carlos.get("/api/pantry").json()
    assert pantry[0]["id"] == entry["id"] and pantry[0]["level"] == "ok"

    # Algo que no estaba en la lista entra como compra nueva, ya comprada.
    carlos.post("/api/receipts/confirm", json={"lines": [{"name": "Pilas", "price_cents": 450, "owner_id": None}]})
    assert carlos.get("/api/items").json()["bought"][0]["name"] == "Pilas"

    money = carlos.get("/api/money").json()
    bal = {b["user_id"]: b["balance_cents"] for b in money["balances"]}
    # Leche 5,34 + papel 3,00 + pilas 4,50 entre los tres (12,84 → 4,28 cada uno); el
    # yogur es de Bea.
    assert bal[bea.user["id"]] == -428 - 199
    assert bal[ana.user["id"]] == -428
    assert bal[carlos.user["id"]] == 1284 - 428 + 199
    feed = carlos.get("/api/activity").json()
    # Una línea por ticket en el feed: el de las pilas y, antes, el del súper.
    assert [(a["kind"], a["detail"].get("count")) for a in feed[:2]] == [("receipt", 1), ("receipt", 3)]


def test_receipt_reading_off_without_ai_key(trio, monkeypatch):
    from nido.settings import settings

    ana, _, _ = trio
    monkeypatch.setattr(settings, "do_api_key", "")
    assert ana.get("/api/house").json()["receipts_enabled"] is False
    res = ana.post("/api/receipts/read", files={"photo": ("t.jpg", b"x", "image/jpeg")})
    assert res.status_code == 503
