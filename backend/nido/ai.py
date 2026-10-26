"""Lectura de tickets con IA (el mismo proveedor y la misma clave que Alpha: DigitalOcean).

La IA lee y Python decide: el modelo transcribe líneas e importes y propone con qué cosa
pendiente de la lista casa cada una; aquí se validan los importes, que las cosas existan y
que ninguna se use dos veces. Leer no guarda nada (ver routers/receipts.py).

La foto va al modelo tal cual, sin ofuscar: un ticket del súper lleva tienda, productos y
precios, y la tarjeta sale enmascarada. Aun así el prompt prohíbe copiar números de tarjeta,
de socio o nombres de personas.
"""

import base64
import json
import re

import httpx
from fastapi import HTTPException

from nido.settings import settings

_TIMEOUT_SECONDS = 120
_MAX_TOKENS = 6000

PROMPT = """Esta imagen es la foto de un ticket de compra (supermercado, droguería, bazar…) en España.
Léelo entero, línea a línea, y devuelve SOLO un JSON, sin texto alrededor ni ```:

{"store": "Mercadona", "date": "AAAA-MM-DD", "total": 54.32,
 "lines": [{"raw": "LECHE SEMI HACENDADO", "name": "Leche semidesnatada", "qty": "6 ud",
            "price": 5.34, "match": 12}]}

Campos de cada línea:
- raw: el texto de la línea tal cual en el ticket.
- name: nombre claro y genérico en castellano, con mayúscula inicial y sin marca salvo que sea
  lo que identifica el producto («Papel higiénico», «Coca-Cola Zero»).
- qty: cantidad legible si el ticket la da («6 ud», «0,85 kg»); "" si es una sola unidad.
- price: importe final de la línea en euros, con su descuento ya aplicado. Las líneas de
  descuento sueltas («DTO 2ª UD -0,50») se restan a la línea del producto al que pertenecen y
  NO van aparte.
- match: el id de la cosa de la lista de abajo que es este producto, o null si no está. Úsalo
  solo si es claramente lo mismo («PAPEL HIG. 12R» es «Papel higiénico»; «Leche de avena» NO es
  «Leche»). Cada id como mucho en una línea.

Reglas:
- total es lo PAGADO, con todos los descuentos.
- No incluyas como líneas el subtotal, el IVA, el cambio, el redondeo ni lo entregado.
- NO copies números de tarjeta, de socio, NIF ni nombres de personas.
- Si un dato no aparece, null. No inventes líneas.

Lista de la compra pendiente (id: nombre):
"""


def enabled() -> bool:
    return bool(settings.do_api_key and settings.do_model)


def _complete_with_image(prompt: str, media_type: str, data: bytes) -> str:
    """Como en Alpha: la ruta /chat/completions del gateway rechaza imágenes aunque el modelo
    las lea; la nativa de Anthropic (/messages), con la misma clave, sí las acepta."""
    try:
        res = httpx.post(
            f"{settings.do_api_url.rstrip('/')}/messages",
            headers={
                "Authorization": f"Bearer {settings.do_api_key}",
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
            },
            json={
                "model": settings.do_model,
                "max_tokens": _MAX_TOKENS,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image",
                                "source": {"type": "base64", "media_type": media_type, "data": base64.b64encode(data).decode()},
                            },
                        ],
                    }
                ],
            },
            timeout=_TIMEOUT_SECONDS,
        )
        res.raise_for_status()
    except httpx.TimeoutException:
        raise HTTPException(504, "La IA ha tardado demasiado. Prueba otra vez.")
    except httpx.HTTPError:
        raise HTTPException(502, "La IA no responde ahora mismo. Prueba en un rato.")
    blocks = res.json().get("content", [])
    return "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()


def _loads(text: str) -> dict:
    # Por si el modelo envuelve el JSON en ``` o añade una frase antes.
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise ValueError("sin JSON")
    return json.loads(match.group(0))


def _cents(value) -> int | None:
    if value is None:
        return None
    try:
        return round(float(str(value).replace(",", ".")) * 100)
    except ValueError:
        return None


def read_receipt(media_type: str, data: bytes, pending: list[dict]) -> dict:
    """Devuelve {store, date, total_cents, lines: [{name, quantity, price_cents, item_id}]}."""
    listing = "\n".join(f"{item['id']}: {item['name']}" for item in pending) or "(vacía)"
    text = _complete_with_image(PROMPT + listing, media_type, data)
    try:
        raw = _loads(text)
    except (ValueError, json.JSONDecodeError):
        raise HTTPException(422, "No se ha entendido el ticket. Prueba con una foto más nítida y recta.")

    pending_ids = {item["id"] for item in pending}
    used: set[int] = set()
    lines = []
    for line in raw.get("lines") or []:
        if not isinstance(line, dict):
            continue
        name = str(line.get("name") or line.get("raw") or "").strip()[:80]
        price = _cents(line.get("price"))
        # Los descuentos sueltos que el modelo no pudo atribuir a nada (negativos) se quedan
        # fuera: la diferencia con el total se ve en la revisión.
        if not name or price is None or price <= 0:
            continue
        match = line.get("match")
        item_id = match if isinstance(match, int) and match in pending_ids and match not in used else None
        if item_id is not None:
            used.add(item_id)
        lines.append({
            "name": name[0].upper() + name[1:],
            "quantity": str(line.get("qty") or "").strip()[:40],
            "price_cents": price,
            "item_id": item_id,
        })
    if not lines:
        raise HTTPException(422, "No se ha leído ninguna línea. Prueba con una foto más nítida y recta.")

    date = raw.get("date")
    return {
        "store": str(raw.get("store") or "").strip()[:60] or None,
        "date": date if isinstance(date, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", date) else None,
        "total_cents": _cents(raw.get("total")),
        "lines": lines,
    }
