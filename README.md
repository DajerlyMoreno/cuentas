# Finanzas en Pareja

App web estática (HTML/CSS/JS) para deudas personales y gastos compartidos del hogar.
Los datos se guardan en Supabase (Postgres) y se sincronizan en tiempo real entre ambos.

## Configurar la base de datos (una sola vez)

1. Crea un proyecto gratis en https://supabase.com.
2. **SQL Editor** → pega y ejecuta el contenido de `supabase.sql`.
3. **Project Settings → API**: copia *Project URL* y *anon public key* en `config.js`.
4. **Authentication → Providers → Email**: si no quieres confirmar por correo, desactiva "Confirm email".
5. **Authentication → URL Configuration**: agrega la URL de tu GitHub Pages en *Site URL*.

## Desplegar en GitHub Pages

1. Sube el repo a GitHub.
2. Settings → Pages → Source: rama `main`, carpeta `/ (root)`.
3. Abre `https://<usuario>.github.io/<repo>/`.

## Uso

- La primera persona se registra y pulsa **Crear hogar nuevo**.
- En **Ajustes** verá el *código del hogar*; la pareja se registra y elige **Unirme con código**.
- Sin `config.js` configurado, la app funciona solo con `localStorage` del navegador.

## Seguridad

La *anon key* es pública por diseño. El acceso a los datos lo restringen las políticas RLS de `supabase.sql`:
solo los miembros de un hogar pueden leer o modificar sus datos.
