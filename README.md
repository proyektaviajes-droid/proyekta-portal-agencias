# Portal privado para agencias - PROYEKTA VIAJES

Este paquete crea una aplicación real para el portal B2B de agencias. No usa datos simulados: funciona contra Supabase/PostgreSQL y solo mostrará datos reales cargados en la base.

## Qué incluye

- Backend Node.js sin dependencias externas.
- Frontend responsive en español.
- Login de administrador.
- Login de agencia con código de agencia y contraseña.
- Invitación segura para que la agencia cree contraseña.
- Gestión inicial de agencias, salidas, reservas, viajeros, pagos, documentos, incidencias, leads y comisiones.
- Migración SQL con tablas, claves, índices, historial, ajustes y políticas RLS base.
- Reserva con código generado en servidor: `PV-2027-MAD-0001`.
- Depósito configurable por salida, por defecto 300 EUR.
- Pagos directos a PROYEKTA VIAJES: transferencia validada por administración.

## Instalación

1. Crear un proyecto Supabase.
2. Ejecutar `db/001_schema.sql` en el SQL editor de Supabase.
3. Copiar `.env.example` a `.env` y completar:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SESSION_SECRET`
   - `BOOTSTRAP_ADMIN_EMAIL`
   - `BOOTSTRAP_ADMIN_PASSWORD`
4. Crear el primer administrador:
   ```powershell
   npm run bootstrap:admin
   ```
5. Arrancar:
   ```powershell
   npm start
   ```
6. Abrir `http://localhost:4177`.

## Producción

- Usar HTTPS obligatorio.
- No publicar la service-role key en el frontend.
- Rotar `SESSION_SECRET`.
- Configurar backups automáticos de Supabase.
- Configurar correo real antes de enviar invitaciones reales.
- Configurar pasarela de pago antes de activar cobros por tarjeta.
- Revisar textos legales, privacidad, condiciones y contratos antes de abrir a agencias.

## Flujo de primera agencia

1. Entrar como administrador.
2. Crear agencia con contrato firmado/pendiente según corresponda.
3. Generar invitación.
4. Enviar el enlace seguro a la agencia.
5. La agencia crea su contraseña.
6. La agencia accede con código `AG-0001` y su contraseña.

## Baja o suspensión de agencias

En administración no se elimina una agencia por defecto. Para conservar reservas, pagos, viajeros, incidencias, comisiones y auditoría:

- `Bloquear`: corta el acceso temporalmente.
- `Desactivar`: corta el acceso de forma indefinida.
- `Reactivar`: devuelve el acceso.

Al bloquear o desactivar una agencia, sus usuarios quedan inactivos y no pueden iniciar sesión. El histórico se conserva.

## Limitaciones actuales conscientes

- El envío de correo real está preparado como evento/notificación, pero no conectado a proveedor SMTP. En producción hay que conectar Resend, SendGrid, SMTP propio o Supabase Edge Function.
- Los pagos por tarjeta no están activados. Hay registro y verificación manual de transferencias.
- Las exportaciones avanzadas PDF/Excel se dejan preparadas a nivel de datos; CSV básico puede añadirse sin cambiar modelo.
