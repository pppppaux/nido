-- Esquema inicial. Una sola casa por despliegue: todos los usuarios comparten lo de aquí.
-- owner_id NULL significa "común"; con valor, es algo personal de ese compañero.

CREATE SEQUENCE IF NOT EXISTS change_seq;

CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    color         TEXT NOT NULL,
    -- Subirla invalida todas las sesiones abiertas (cambio de contraseña).
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lo que hay en casa y cómo va de existencias.
CREATE TABLE pantry (
    id         BIGSERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    category   TEXT NOT NULL,
    owner_id   BIGINT REFERENCES users (id) ON DELETE CASCADE,
    level      TEXT NOT NULL DEFAULT 'ok' CHECK (level IN ('ok', 'low', 'out')),
    updated_by BIGINT REFERENCES users (id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La lista de la compra. Un elemento comprado se queda (bought_at) para el historial.
CREATE TABLE items (
    id         BIGSERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    quantity   TEXT NOT NULL DEFAULT '',
    note       TEXT NOT NULL DEFAULT '',
    category   TEXT NOT NULL,
    owner_id   BIGINT REFERENCES users (id) ON DELETE CASCADE,
    urgent     BOOLEAN NOT NULL DEFAULT false,
    pantry_id  BIGINT REFERENCES pantry (id) ON DELETE SET NULL,
    created_by BIGINT REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    bought_by  BIGINT REFERENCES users (id) ON DELETE SET NULL,
    bought_at  TIMESTAMPTZ,
    -- Lo que costó, si alguien lo apunta. Solo pasa a las cuentas (expenses) cuando lo
    -- pagado es para otro: lo tuyo comprado por ti no le debe nada a nadie.
    price_cents INTEGER CHECK (price_cents > 0)
);
CREATE INDEX items_pending ON items (created_at) WHERE bought_at IS NULL;
CREATE INDEX items_bought ON items (bought_at DESC) WHERE bought_at IS NOT NULL;

-- Dinero. kind: purchase (una compra de la lista con precio), expense (un gasto suelto)
-- o settlement (un compañero le paga a otro). El reparto se guarda ya hecho en
-- expense_shares: si cambia la gente del piso, lo pasado no se recalcula.
CREATE TABLE expenses (
    id           BIGSERIAL PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('purchase', 'expense', 'settlement')),
    description  TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    paid_by      BIGINT NOT NULL REFERENCES users (id),
    item_id      BIGINT REFERENCES items (id) ON DELETE SET NULL,
    spent_on     DATE NOT NULL DEFAULT CURRENT_DATE,
    created_by   BIGINT REFERENCES users (id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX expenses_item ON expenses (item_id) WHERE item_id IS NOT NULL;

CREATE TABLE expense_shares (
    expense_id  BIGINT NOT NULL REFERENCES expenses (id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users (id),
    share_cents INTEGER NOT NULL,
    PRIMARY KEY (expense_id, user_id)
);

-- Lo que ha pasado, para el feed. subject es el texto que se enseña (el nombre de la cosa).
CREATE TABLE activity (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT REFERENCES users (id) ON DELETE SET NULL,
    kind       TEXT NOT NULL,
    subject    TEXT NOT NULL,
    detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX activity_recent ON activity (created_at DESC);
