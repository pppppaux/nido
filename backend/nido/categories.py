"""Categorías fijas y la adivinanza de categoría a partir del nombre.

Adivinar evita que haya que elegir categoría para cada cosa que se apunta: "leche"
cae en Nevera sola. Si se equivoca, se cambia a mano y la próxima vez manda lo que
ya se usó en casa (ver guess_category en routers/items.py).
"""

import unicodedata

CATEGORIES: list[dict[str, str]] = [
    {"id": "fresco", "name": "Fruta y verdura"},
    {"id": "nevera", "name": "Nevera y congelados"},
    {"id": "despensa", "name": "Despensa"},
    {"id": "bebidas", "name": "Bebidas"},
    {"id": "limpieza", "name": "Limpieza"},
    {"id": "bano", "name": "Baño e higiene"},
    {"id": "hogar", "name": "Hogar"},
    {"id": "otros", "name": "Otros"},
]
CATEGORY_IDS = {c["id"] for c in CATEGORIES}

_KEYWORDS: dict[str, tuple[str, ...]] = {
    "fresco": (
        "manzana", "platano", "naranja", "limon", "pera", "uva", "fresa", "melon", "sandia",
        "kiwi", "aguacate", "tomate", "lechuga", "cebolla", "ajo", "patata", "zanahoria",
        "pimiento", "calabacin", "berenjena", "pepino", "espinaca", "brocoli", "champinon",
        "seta", "fruta", "verdura", "ensalada", "perejil", "cilantro", "mandarina", "piña",
        "pina", "mango", "rucula", "puerro", "calabaza", "boniato", "jengibre",
    ),
    "nevera": (
        "leche", "yogur", "queso", "mantequilla", "huevo", "jamon", "pavo", "chorizo",
        "fiambre", "pollo", "carne", "ternera", "cerdo", "pescado", "salmon", "merluza",
        "atun fresco", "gamba", "nata", "helado", "congelad", "pizza", "hamburguesa",
        "salchicha", "bacon", "beicon", "embutido", "tofu", "hummus", "mozzarella",
        "kefir", "skyr", "masa", "croqueta",
    ),
    "despensa": (
        "pan", "arroz", "pasta", "macarron", "espagueti", "harina", "azucar", "sal",
        "aceite", "vinagre", "atun", "lata", "legumbre", "garbanzo", "lenteja", "alubia",
        "cereal", "galleta", "cafe", "te ", "infusion", "cacao", "chocolate", "tomate frito",
        "especia", "pimienta", "oregano", "mayonesa", "ketchup", "mostaza", "salsa",
        "caldo", "avena", "mermelada", "miel", "frutos secos", "nueces", "almendra",
        "patatas fritas", "snack", "tortilla", "pan de molde", "biscote", "levadura",
    ),
    "bebidas": (
        "agua", "cerveza", "vino", "refresco", "coca", "zumo", "fanta", "aquarius",
        "tonica", "ron", "ginebra", "vodka", "whisky", "sidra", "bebida", "cava",
    ),
    "limpieza": (
        "lavavajillas", "fregasuelos", "lejia", "detergente", "suavizante", "estropajo",
        "bayeta", "friegaplatos", "bolsa de basura", "bolsas de basura", "basura",
        "limpiacristales", "multiusos", "amoniaco", "quitagrasas", "fregona", "escoba",
        "guantes", "pastillas lavavajillas", "jabon de ropa", "insecticida", "ambientador",
        "papel de cocina", "rollo de cocina", "servilleta",
    ),
    "bano": (
        "papel higienico", "champu", "gel", "jabon", "pasta de dientes", "dentifrico",
        "cepillo", "desodorante", "compresa", "tampon", "maquinilla", "cuchilla",
        "crema", "colutorio", "toallita", "algodon", "bastoncillo", "pañuelo", "panuelo",
        "acondicionador", "seda dental", "tirita", "ibuprofeno", "paracetamol",
    ),
    "hogar": (
        "bombilla", "pila", "bateria", "vela", "cable", "enchufe", "regleta", "toalla",
        "sabana", "funda", "percha", "papel aluminio", "aluminio", "film", "tupper",
        "mechero", "cerilla", "plato", "vaso", "taza", "sarten", "olla", "cubierto",
        "maceta", "planta", "herramienta", "destornillador", "cinta",
    ),
}


def normalize(text: str) -> str:
    """minúsculas y sin tildes, para comparar nombres ("Plátano" == "platano")."""
    text = unicodedata.normalize("NFKD", text.strip().lower())
    return "".join(ch for ch in text if not unicodedata.combining(ch))


def guess_from_keywords(name: str) -> str:
    padded = f" {normalize(name)} "
    best: tuple[int, str] | None = None
    for category, words in _KEYWORDS.items():
        for word in words:
            # La palabra más larga que encaje gana: "papel de cocina" es limpieza aunque
            # "cocina" no diga nada, y "tomate frito" es despensa aunque "tomate" sea fresco.
            # Se busca al principio de una palabra: "ron" no es bebida dentro de "turrón".
            if f" {word}" in padded and (best is None or len(word) > best[0]):
                best = (len(word), category)
    return best[1] if best else "otros"
