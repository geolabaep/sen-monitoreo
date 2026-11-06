# GEOlab – SEN | v27 (GitHub Pages + Supabase)

Aplicación web ligera para seguimiento de expedientes de la Secretaría de Emergencia Nacional. El mapa y los logos están incluidos en la carpeta; las fichas privadas, los usuarios y el historial se guardan en Supabase.

## Permisos

| Función | Visitante (sin cuenta) | Operador SEN | Administrador |
|---|:---:|:---:|:---:|
| Navegar mapa, distritos y cantidades por estado | ✓ | ✓ | ✓ |
| Ver expediente, datos personales e historial | No | ✓ | ✓ |
| Crear/importar/editar/exportar expedientes | No | ✓ | ✓ |
| Crear usuarios operadores | No | No | ✓ |

**Seguridad:** la restricción no se basa solo en botones ocultos. La base de datos activa Row Level Security (RLS). La vista pública consulta exclusivamente zona administrativa y estado operativo: nunca nombres, números de expediente, datos de personas afectadas ni coordenadas exactas. No subas el JSON de 68 alertas o las planillas reales al repositorio.

## 1. Crear proyecto de Supabase

1. Creá un proyecto administrado institucionalmente en https://supabase.com/dashboard.
2. En **SQL Editor**, pegá y ejecutá `supabase/schema.sql`. Este paso crea las tablas, restricciones, auditoría y políticas de seguridad.
3. En **Authentication → Providers → Email**, verificá que funcione Email/Password. Desactivá el alta pública de usuarios (**Allow new users to sign up**, si aparece): el personal debe crearse por administrador.
4. En **Authentication → Users**, creá manualmente una única cuenta institucional administradora con correo y contraseña fuerte. **No pongas esa contraseña en archivos.**
5. En **SQL Editor**, después de crear la cuenta ejecutá, sustituyendo el correo:

   ```sql
   UPDATE public.profiles
   SET role='admin', active=true
   WHERE email='correo-administrador@institucion.gov.py';
   ```

   Confirmá que afecte **una sola fila**. Si no actualiza ninguna, verificá que existe en Authentication → Users.

## 2. Preparar la función de crear operadores

Esta operación debe ejecutarse en el servidor porque necesita una clave secreta. **Nunca uses una clave secreta o service_role en GitHub.**

Forma simple: en Supabase **Edge Functions → Deploy a new function** creá una función llamada `create-operator`, copiá el contenido de `supabase/functions/create-operator/index.ts` y desplegala. Si tu panel requiere la CLI, instalá Supabase CLI y, desde la carpeta del proyecto, usá:

```bash
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase functions deploy create-operator --no-verify-jwt
```

El flag `--no-verify-jwt` se usa porque **la función valida explícitamente el JWT del usuario con `auth.getUser()` y comprueba en servidor que sea administrador**. No significa que admita llamadas sin autenticar. La función lee la clave secreta solo de las variables de entorno del servidor provistas por Supabase.

El administrador asigna una contraseña temporal de al menos 12 caracteres y la entrega por un canal seguro al operador. Luego el operador puede cambiar su contraseña desde la aplicación. Para producción, conviene configurar MFA, correo institucional/SMTP, reglas de contraseñas y un procedimiento de desactivación de cuentas.

## 3. Configurar la página

1. En Supabase, buscá la URL del proyecto y la **publishable key**, normalmente `sb_publishable_...`, en **Project Settings / API Keys** o **Connect**.
2. Abrí `config.js`, reemplazá `PEGAR_URL_SUPABASE` y `PEGAR_CLAVE_PUBLICABLE_SUPABASE`.
3. Podés publicar la URL y la **publishable key** en el código frontend: son públicas por diseño. **No pongas la secret key en ningún archivo público**.
4. Probá iniciar sesión con la cuenta administradora y crear un operador.

## 4. Publicar en GEOlab GitHub

1. Ingresá a https://github.com/geolabaep con un usuario autorizado.
2. Creá un repositorio, por ejemplo `sen-monitoreo` (público si se usa GitHub Pages gratuito).
3. Subí los archivos `index.html`, `app.js`, `config.js`, `zones.js`, `.nojekyll`, `README.md` y la carpeta `supabase` a la raíz. **No subas datos reales**.
4. Elegí **Settings → Pages → Deploy from a branch → main → /(root) → Save**.
5. La URL estimada será `https://geolabaep.github.io/sen-monitoreo/`.
6. Probá en una ventana de incógnito que solo aparezcan mapa y cantidades por estado, sin fichas ni información personal.

## 5. Cargar los expedientes históricos (solo desde una cuenta autorizada)

1. Iniciá sesión como administrador u operador.
2. En **Importar y respaldar**, seleccioná el respaldo JSON generado previamente con los 68 registros, **desde tu computadora**.
3. El sistema importa los expedientes que no existan y conserva las actuaciones previas como `migrated_history`, accesibles solo para el personal autorizado.
4. El nuevo historial institucional se registra automáticamente en la tabla `event_audit` al crear y editar.
5. El CSV compatible de versiones anteriores también se puede importar. Para archivos `.xlsx`, guardá como **CSV UTF-8** en Excel antes de subirlos.

## Almacenamiento y continuidad

- GitHub Pages solo sirve archivos de la aplicación; **no almacena expedientes nuevos**.
- Supabase almacena expedientes, perfiles, cambios e historial, compartidos entre dispositivos.
- Los operadores necesitan Internet para iniciar sesión y gestionar registros. El mapa base está integrado, pero el estado público se lee desde Supabase.
- Los backups CSV/JSON son complementarios; establecé copias de seguridad automatizadas, control de acceso institucional y una política de retención antes del uso operativo.
- El plan gratuito de Supabase puede tener límites, pausa por inactividad y restricciones de copias de seguridad. Para una implementación crítica, evaluar plan con SLA y requisitos de privacidad.
- Probar permisos RLS, el flujo de alta/desactivación, recuperación de cuenta y exportaciones antes de producción. Si se usan datos personales, completar revisión institucional y jurídica de privacidad.

## Estructura

```text
index.html
app.js
zones.js
config.js
.nojekyll
README.md
supabase/
  schema.sql
  functions/create-operator/index.ts
```

**No se incluyen registros reales en esta carpeta**, para que pueda publicarse de forma segura. Los 68 registros se cargan después de la configuración a la base privada.
