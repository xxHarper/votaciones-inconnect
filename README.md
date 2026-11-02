# OfrendaVote · INCONNECT

Aplicación local para el concurso interno de ofrendas del Día de Muertos. React + Vite, Express y SQLite; exactamente seis mesas. Funciona desde computadoras de la empresa, en una estación compartida o varias estaciones autorizadas de la LAN. No necesita internet durante su operación, CDN, cuentas externas ni servicios de pago.

## Requisitos

- **Node.js 24 LTS, versión 24.14 o posterior de la rama 24**, con npm. Se usa SQLite integrado en Node, sin compilar módulos nativos. [Documentación de SQLite en Node](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html).
- Windows 10/11 o Linux, disco local y navegador moderno en las computadoras autorizadas.
- Internet únicamente para instalar Node y descargar dependencias inicialmente. Después, conservar el proyecto con `node_modules` instalado en el sistema operativo del servidor y `dist` generado. No compartir `node_modules` entre Windows y Linux.
- Evitar carpetas sincronizadas o unidades de red para SQLite. Hacer una instalación de producción en una carpeta local protegida.

## Instalación rápida

En PowerShell o una terminal Linux, dentro de la carpeta del proyecto:

```sh
npm ci
npm run setup
npm run build
npm start
```

`setup` crea `.env` desde `.env.example`, genera un secreto aleatorio y pide una contraseña de **14–256 caracteres** dos veces, sin mostrarla. No hay contraseña predeterminada. Usa una frase larga y exclusiva. No se guarda la contraseña: solo un hash scrypt con sal aleatoria. La base y sus seis mesas se crean automáticamente mediante la migración versionada `server/migrations/001_initial.sql`.

La estación está en `http://localhost:3000` y la administración en `http://localhost:3000/admin`. La base vacía no incluye participantes de ejemplo. Los dibujos locales son ilustraciones de referencia, identificadas como tales; carga las fotos reales antes de abrir.

### Inicio y reinicio cotidianos

1. Abre una terminal en la carpeta del proyecto.
2. Ejecuta `npm start`. Deja esa terminal abierta mientras dure el concurso.
3. Para detener, pulsa **Ctrl+C** y espera a que termine el proceso.
4. Para reiniciar, vuelve a ejecutar `npm start`. Los participantes, fotos, estado y votos permanecen en SQLite.

También se incluyen `scripts/iniciar-windows.cmd` y `scripts/iniciar-linux.sh`. Si el servidor se reinicia, vuelve a ejecutar el script. Para inicio desatendido, configura el Programador de tareas de Windows o la unidad systemd de `docs/ofrendavote.service.example`; usa una cuenta de servicio con acceso exclusivo a la carpeta de datos. Ejecutar siempre una sola instancia por base de datos y no usar modo clúster.

## Configuración de red para computadoras de la empresa

Edita `.env` con el servidor detenido:

```dotenv
HOST=0.0.0.0
PORT=3000
DB_PATH=./data/production.sqlite
```

`0.0.0.0` escucha en todas las interfaces IPv4. Para una interfaz específica usa, por ejemplo, `HOST=192.168.10.20`. La URL de los puestos es `http://192.168.10.20:3000`; `0.0.0.0` no es la dirección que deben escribir. Consulta `ipconfig` en Windows o `ip address` en Linux y reserva una IP fija en la LAN. Configura las reglas para las IP concretas de los puestos autorizados. No abras este servicio a internet ni configures redirecciones en el router.

**Windows**, PowerShell como administrador (sustituye las IP por las reales):

```powershell
New-NetFirewallRule -DisplayName "OfrendaVote puestos autorizados" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -Profile Domain,Private -RemoteAddress 192.168.10.31,192.168.10.32
```

**Linux con UFW** (repite para cada puesto autorizado):

```sh
sudo ufw allow from 192.168.10.31 to any port 3000 proto tcp
```

El firewall determina qué computadoras están autorizadas. Si se cambia `PORT`, ajustar también el firewall. Probar la URL desde cada puesto antes del concurso. Para una única computadora puede usarse `HOST=127.0.0.1`, sin acceso LAN.

### HTTPS local

Para proteger códigos y contraseñas durante su tránsito por la LAN, usa un certificado de la autoridad interna que confíen las computadoras de la empresa. Express admite HTTPS directo, sin proxy obligatorio:

```dotenv
TLS_KEY=./certs/servidor-key.pem
TLS_CERT=./certs/servidor-cert.pem
COOKIE_SECURE=true
```

Accede entonces con `https://IP_O_NOMBRE:3000`. El nombre/IP debe figurar en el certificado. Ambos PEM son necesarios. Para HTTP local dejar ambos vacíos y `COOKIE_SECURE=false`. El servidor rechaza combinaciones incoherentes. La cookie administrativa usa HttpOnly, SameSite=Strict y Secure con HTTPS. No se confía en cabeceras de proxy. Si se agrega un proxy corporativo, adaptar y revisar explícitamente esa configuración antes de usarlo.

En producción no hacen falta orígenes adicionales. `ALLOWED_ORIGINS` permite orígenes exactos separados por coma cuando sean necesarios; no admite comodines. No configures orígenes de terceros. Las mutaciones requieren cabecera Origin del mismo origen y las acciones administrativas, además, token CSRF.

## Operación del concurso

1. Entrar a `/admin` desde una computadora bajo control del organizador.
2. Registrar personas individualmente o importar CSV UTF-8:

   ```csv
   identificador,nombre,correo,mesa
   EMP001,Ana López,ana@inconnect.local,1
   EMP002,"Pérez, Luis",,6
   ```

   `identificador`, `nombre`, `mesa` son obligatorios; `correo` es opcional. Identificador de 1–64 letras, números, guion o guion bajo, sin espacios. Nombre de 2–120 caracteres. Mesas enteras del 1 al 6. Los identificadores no pueden repetirse, sin distinguir mayúsculas. Hasta 10 000 filas y 1 MB por petición. El lote completo se rechaza ante errores, duplicados o correo inválido. Se aceptan nombres entrecomillados con comas. No se sobrescriben registros existentes.
   Antes de abrir también puedes editar nombres, correos y mesas. Cambiar una mesa invalida el código emitido para esa persona; vuelve a emitir y entregar uno nuevo antes de abrir. El identificador se conserva.
3. Configurar nombres y fotos PNG/JPG/WebP de las seis ofrendas, hasta 5 MB cada una. Las fotos se guardan **dentro de SQLite**, por lo que entran en el respaldo.
4. Usar **Emitir códigos** y confirmar contraseña. Se genera un CSV únicamente para registros sin código emitido. Cada código tiene 16 caracteres y 80 bits de aleatoriedad criptográfica, sin I, O, 0 ni 1. El código se ve solo en esta respuesta de descarga; la base conserva exclusivamente HMAC-SHA-256 con secreto local. No se guardan archivos de códigos en el servidor de producción.
5. Guardar esa descarga en un lugar protegido, entregar cada código individualmente y eliminar el archivo cuando ya no se necesite. **No es posible volver a descargar el mismo código**. Si la descarga falla después de confirmarse, regenerar los códigos afectados. No se muestra ni se conserva el valor anterior.
6. Abrir votación y confirmar contraseña. Debe existir al menos una persona y todas deben tener un código emitido. Desde entonces se bloquean altas, importación, identidad, mesa y edición de ofrendas. No se puede volver a preparación.
7. Supervisar participación total y por mesa de origen. Los estados son **sin código**, **habilitado · pendiente** y **ya votó**. El panel nunca muestra la selección de una persona ni el conteo por ofrenda mientras esté abierto.
8. Cerrar votación y confirmar contraseña. El cierre es definitivo e invalida las sesiones de votante. Consultar ranking, votos, porcentajes, participación y empates, y exportar resultados CSV. Los porcentajes por ofrenda usan el total de votos válidos; la participación usa el total de personas registradas. Con cero votos hay seis empates en primer lugar.
9. Cerrar la sesión administrativa antes de dejar la computadora. El panel administrativo no debe quedar abierto en una estación de uso público.

### Código perdido y otras operaciones sensibles

En Participantes, **Regenerar código** requiere volver a escribir el identificador exacto y la contraseña del administrador. Solo se permite si la persona no votó y el concurso no terminó; invalida el código anterior y todas sus sesiones, emite un nuevo CSV y deja registro administrativo sin preferencias de voto. Es la excepción operativa permitida después de la apertura.

No existe interfaz para cambiar mesas, eliminar votos, habilitar un segundo voto o reabrir el concurso. Una asignación incorrecta detectada después de abrir exige detener el proceso y organizar un nuevo concurso sobre una base nueva, con códigos nuevos y comunicación interna explícita. No editar SQLite manualmente. Cambiar la contraseña administrativa con el servidor detenido:

```sh
npm run admin:reset
```

Esto invalida las sesiones administrativas. El registro de actividad contiene operaciones y referencias de gestión, nunca papeletas, códigos ni sesiones de votante.

## Modo de computadora compartida

- La pantalla pública solicita el código personal y muestra nombre y mesa solo después de validarlo en el servidor.
- Presenta las seis mesas; la propia aparece bloqueada. El servidor vuelve a validar esa restricción.
- Elegir y confirmar son pasos separados. Un voto exitoso elimina la sesión en el servidor y limpia identidad, código, selección y credencial en React; el agradecimiento no contiene información personal.
- Regreso automático al acceso después de 7 segundos y botón para hacerlo inmediatamente.
- Cierre por 90 segundos de inactividad, configurable en `VOTER_IDLE_SECONDS`; límite absoluto de 600 segundos en `VOTER_MAX_SECONDS`. Los movimientos de entrada reales renuevan la inactividad con comprobación del servidor. Las consultas periódicas de estado no renuevan la sesión.
- La credencial del votante existe solo en memoria de su pestaña; no hay cookie de votante, localStorage, sessionStorage, parámetros en la URL ni autocompletado. Una nueva pestaña o recarga empieza en acceso, sin recuperar identidad. Cambiar de pestaña u ocultar la página limpia el estado y solicita revocación. Atrás/adelante desde caché también limpia. Si una revocación se pierde por desconexión, el token permanece inaccesible y expira en el servidor.
- Iniciar de nuevo con el mismo código antes de votar revoca cualquier sesión anterior. Después de votar, el código ya no sirve desde ninguna computadora.
- El puesto debe usar un perfil de navegador dedicado, sin extensiones, con guardado de contraseñas y restauración automática de pestañas desactivados por política de la empresa. El frontend solicita no autocompletar; las políticas corporativas evitan que gestores externos ignoren esa solicitud.
- Los errores de código son genéricos. Hay límites por IP para intentos fallidos: 30 para códigos y 8 para administrador por cada 15 minutos. Los accesos exitosos no consumen la cuota del kiosco. No se usa la IP para determinar quién ya votó.

## Persistencia, secreto y transacciones

`participants` guarda identidad, mesa de pertenencia, hash de código y estado. `ballots` guarda solamente un UUID aleatorio y mesa elegida: sin identificador de participante, código, sesión, fecha ni secuencia autoincremental. Al emitir el voto se ejecuta **BEGIN IMMEDIATE**, se comprueba apertura, sesión, pertenencia y estado, se hace una actualización condicional de `voted=0` a `voted=1` borrando el hash, se inserta la papeleta y se revocan todas las sesiones. Todo se confirma junto o se revierte junto. WAL, `synchronous=FULL`, claves foráneas, restricciones y triggers preservan las invariantes. Las consultas usan parámetros, y la API rechaza campos inesperados.

No se registran cuerpos de peticiones, elecciones ni accesos de votantes. Si se añade un proxy, APM o registros HTTP, no registrar Authorization, cookies, cuerpos ni respuestas de autenticación/voto. Los resultados y las identidades solo son accesibles con sesión administrativa. No hay endpoint para votos individuales.

El secreto descrito corresponde a la separación lógica y la aplicación. Quien controla el sistema operativo, lee memoria, observa tráfico sin HTTPS o compara copias de SQLite/WAL entre transacciones puede inferir información; esta aplicación no implementa un protocolo criptográfico de anonimato frente al administrador del servidor. Restringe acceso al disco, respaldos y servidor. No distribuyas respaldos ni permisos directos sobre SQLite entre organizadores. `secure_delete` y la eliminación del hash no equivalen a borrado forense de todas las copias.

## Respaldos y restauración

### Crear un respaldo

Puede hacerse con el servidor en funcionamiento. La API de respaldo de SQLite crea una instantánea consistente, incluyendo fotos, sin copiar incorrectamente un archivo WAL activo:

```sh
npm run backup
npm run backup -- /ruta/protegida/concurso-2026.sqlite
```

En Windows, por ejemplo `npm run backup -- "D:\Respaldos\concurso-2026.sqlite"`. El destino debe ser nuevo; no se sobrescriben archivos. Respalda además `.env` **por separado**, protegido por permisos y/o cifrado corporativo. `CODE_PEPPER` debe acompañar al respaldo adecuado; cambiarlo invalida códigos pendientes. Los respaldos contienen datos personales, hashes y sesiones y deben quedar bajo control del responsable. Linux aplica modo 600 al respaldo; en Windows restringir ACL de la carpeta a la cuenta de servicio y administradores con `icacls` o Propiedades → Seguridad. Usar cifrado de disco o del medio de respaldo conforme a la política interna.

### Restaurar

1. Detener con Ctrl+C y comprobar que no hay otro proceso Node usando la base.
2. Recuperar la configuración `.env` correspondiente (sobre todo `CODE_PEPPER`).
3. Ejecutar:

   ```sh
   npm run restore -- /ruta/protegida/concurso-2026.sqlite --confirm
   ```

4. Se verifica integridad, claves foráneas, versión, seis mesas y correspondencia entre papeletas y participantes que votaron. Se invalidan sesiones. Se crea automáticamente una copia previa de la base actual junto a ella y se reemplaza la base validada.
5. Ejecutar `npm start` y comprobar participantes y estado en `/admin`.

**Un respaldo anterior a votos ya recibidos no incluye esos votos**: restaurarlo permitiría repetirlos. Restaurar solamente como recuperación controlada, después de evaluar ese punto y detener las estaciones. Nunca usar la restauración para reabrir o modificar elecciones. El script exige servidor detenido mediante un archivo de bloqueo exclusivo `DB_PATH.lock`. Si hubo un cierre forzado y queda un bloqueo residual, verificar el PID del archivo con `Get-Process -Id PID` en Windows o `ps -p PID` en Linux; solo después de confirmar que no existe un servidor activo, eliminar ese archivo `.lock`. No borrar archivos `-wal` o `-shm` a mano.

## Desarrollo, build y pruebas

```sh
npm run dev
npm test
npm run build
npm start
```

Desarrollo abre Vite en `http://localhost:5173` y Express en el puerto configurado (3000 normalmente). La instalación requiere `npm run setup` previamente. Vite hace proxy de `/api`; `DEV_ORIGIN` debe coincidir con la URL exacta del navegador de desarrollo. Para producción se sirve React compilado desde Express en un único origen; Vite no es el servidor de producción.

Las pruebas usan bases temporales independientes, sin tocar producción: voto duplicado, voto propio, códigos inválidos, solicitudes manipuladas, cierre, rollback, API privada, CSRF, cookies, caducidad, regeneración, importación completa, fotos, resultados y límites. La concurrencia se prueba tanto con solicitudes HTTP simultáneas como con **ocho hilos y conexiones SQLite independientes** compitiendo por la misma persona. `npm run migrate` aplica las migraciones con servidor detenido. `package-lock.json` fija las versiones reproducibles.

Pruebas del navegador para la estación y la administración:

```sh
npx playwright install chromium
npm run test:e2e
```

En Linux, si faltan bibliotecas del navegador, instala las dependencias de prueba con `npx playwright install --with-deps chromium` (requiere permisos administrativos del sistema).

La descarga de Chromium solo es necesaria para las pruebas de desarrollo, no para operar el concurso. El entorno E2E genera su propia base temporal, contraseña y códigos; ejecuta el build primero. No se recomienda ejecutar comandos de desarrollo desde una terminal con variables `DB_PATH` de producción exportadas.

## Demostración separada

```sh
npm run demo
```

En su primer inicio pide una contraseña exclusiva de demostración y crea **data/demo.sqlite**, `.env.demo` y **data/demo-codigos.csv**, separados de producción, con 18 personas ficticias distribuidas entre las seis mesas. Accede a `http://localhost:3001/admin`, abre el concurso y prueba la estación con esos códigos. El archivo demostrativo de entrega es deliberado y nunca se genera en producción. El concurso de demostración también tiene cierre irreversible. Para empezar una demostración nueva, detenerla y eliminar únicamente los tres archivos de demostración anteriores; nunca eliminar la base de producción. Ejecutar `npm run build` antes del demo.

## Estructura

- `src/`: React, interfaz de estación y panel administrativo independiente.
- `public/art/`: seis ilustraciones SVG propias incluidas, sin fuentes externas.
- `server/`: Express, validaciones, seguridad, sesiones SQLite y operación de voto.
- `server/migrations/`: esquema versionado y triggers.
- `scripts/`: instalación, respaldo, restauración, demo y arranque.
- `tests/`: pruebas automatizadas; `tests/e2e/`: recorridos de navegador.
- `.env.example`: configuración sin secretos ni contraseñas reales.

Las decisiones y límites operativos están documentados aquí para evitar excepciones ocultas durante el concurso.
