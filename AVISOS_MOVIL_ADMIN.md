# Avisos de actividad para Administración

El portal enviará avisos web push a los dispositivos donde el administrador los haya activado. Se notifican reservas, altas y cambios de viajeros, pagos comunicados, incidencias, solicitudes de cambio, contratos y altas, envíos o retiradas de documentación de reserva y viajero. Los avisos no incluyen datos personales ni contenido de documentos.

## Publicación

1. Aplicar `db/012_admin_push_subscriptions.sql` al proyecto Supabase conectado al portal.
2. Publicar la versión del servicio desde la rama con estos cambios.
3. Iniciar sesión como administrador desde cada dispositivo y pulsar **Activar avisos en este dispositivo**. Aceptar el permiso del navegador.

La clave VAPID se deriva de `SESSION_SECRET` en el servidor, así que no hay que copiar claves ni guardar secretos nuevos en el hosting. No rotar `SESSION_SECRET` después de activar los dispositivos; si se cambia, habrá que volver a activar los avisos.

En iPhone y iPad, añade antes el portal a la pantalla de inicio desde Safari y ábrelo desde ese icono. En Mac, autoriza las notificaciones de Safari. La cuenta compartida no sincroniza automáticamente los permisos: la activación se hace una vez en cada dispositivo.
