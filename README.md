# Nido

La app del piso: lo que falta en casa (común o de cada uno), lo que hay, y quién ha pagado qué.

- **Lista**: se apunta lo que falta, para la casa o para alguien. Quien lo compra lo tacha y, si quiere, pone el precio. Lo común se reparte entre todos; lo de otro, se lo debe a quien lo compró.
- **Casa**: inventario con tres niveles: hay, poco o nada. Marcar «poco» o «nada» lo apunta solo en la lista, y comprarlo lo devuelve a «hay».
- **Cuentas**: saldo de cada uno, los pagos mínimos para quedar en paz, gastos sueltos (luz, internet…) y pagos entre compañeros.
- **Ticket**: haces una foto al ticket y la IA saca las líneas y los precios, y casa cada una con lo pendiente de la lista. No se apunta nada hasta que lo revisas: puedes quitar lo que es solo tuyo, cambiar para quién es cada cosa, corregir precios y añadir líneas que falten. Al confirmar, lo que estaba en la lista se tacha; lo demás entra como compra nueva. Todo pasa a las cuentas.
- **Actividad**: lo que ha hecho cada uno.

Se refresca sola: cada 6 s mira `/api/pulse` y solo recarga si algo ha cambiado. Se puede instalar en el móvil («Añadir a pantalla de inicio»).

## Piezas

| | Dónde | Qué |
|---|---|---|
| `frontend/` | GitHub Pages (`https://pppppaux.github.io/nido/`) | Vite + React + Tailwind. Se publica sola con `.github/workflows/pages.yml` |
| `backend/` | VM de Oracle de Alpha, `https://nido.alphaos.duckdns.org` | FastAPI en `127.0.0.1:8100`, detrás del nginx + WAF de Alpha |
| base | Neon, base `nido` en el mismo proyecto que Alpha | Las migraciones (`backend/nido/migrations/`) se aplican al arrancar |
| `ansible/` | | Despliegue de la API. Usa el inventario, el vault y los roles de `../alpha/ansible` |

La web y la API van en dominios distintos, así que la sesión es un JWT guardado en el navegador y enviado en `Authorization`. No va en cookie porque Safari bloquea las cookies de terceros. La API solo contesta por CORS al origen de Pages (`ALLOWED_ORIGINS`).

Para registrarse hace falta el **código de la casa** (`INVITE_CODE`). Desde Perfil se copia un enlace de invitación que ya lo lleva.

**El registro está cerrado** en producción (`nido_registration_open: false` en `ansible/playbooks/group_vars/all/nido.yaml`). Con el registro cerrado, la API rechaza las altas aunque traigan el código, y la web no enseña ni "Crear cuenta" ni el enlace de invitación. Para que entre alguien, se pone a `true`, se despliega y, cuando se haya registrado, se vuelve a cerrar.

El nombre y el usuario no se cambian desde la app, solo en la base (tabla `users`).

## En local

Hace falta el Postgres de Alpha (`alpha-pg`, colima, puerto 5433), con las bases `nido` y `nido_test`.

```bash
cd backend
uv venv -p 3.12 .venv && uv pip install -p .venv -r requirements-dev.txt
# .env: DATABASE_URL, JWT_SECRET, INVITE_CODE, ALLOWED_ORIGINS=http://localhost:5180
.venv/bin/uvicorn nido.main:app --port 8100 --reload
.venv/bin/python -m pytest -q           # usa TEST_DATABASE_URL de .env.test

cd ../frontend
npm install && npm run dev               # http://localhost:5180, /api va al 8100
```

## Desplegar

**API**, desde aquí y con Tailscale conectado:

```bash
cd ansible
ansible-playbook playbooks/nido.yml 2>&1 | cat
```

Es idempotente y la primera vez además:
- crea la base `nido` en Neon;
- pide el certificado de `nido.alphaos.duckdns.org` por DNS-01. Es un subdominio de alphaos: DuckDNS ya lo resuelve a la IP de la VM y no hay que dar de alta nada;
- aplica los roles `modsecurity` y `resource_limits` de Alpha.

Los secretos están en el vault de Alpha (`vault_nido_jwt_secret`, `vault_nido_invite_code`). Este repo no guarda ninguno porque es público, que es lo que pide Pages gratis.

**Web**: un push a `master` que toque `frontend/` la publica. La primera vez, en el repo de GitHub: *Settings → Pages → Source: GitHub Actions*.

## Cosas que no se ven en el código

- **WAF**: el dominio de Nido está exento del token `X-Alpha-Client` de Alpha (`modsecurity_client_token_exempt_hosts` en los group_vars de Alpha). Sigue pasando por el CRS y por los límites de nginx, y el login y el registro tienen el límite de credenciales (`/api/auth/(login|register|password)`).
- **Copias**: el `pg_dump` diario de Alpha solo copia la base `alpha`. De `nido` solo queda el historial de Neon.
- **Un solo piso por despliegue**: toda la gente registrada comparte lo mismo.
- **IA de los tickets**: usa el mismo proveedor y la misma clave que Alpha (DigitalOcean, `vault_do_*`), por la ruta `/messages`, porque `/chat/completions` rechaza imágenes. La foto no se guarda en ningún sitio y va al modelo sin ofuscar (un ticket del súper no lleva datos personales; el prompt prohíbe copiar tarjeta o socio). Cada lectura cuesta unos céntimos.
