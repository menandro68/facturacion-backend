# INCIDENT RESPONSE - SistemaDeFacturacion

> Guia profesional para manejar incidentes en produccion.
> Ultima actualizacion: Mayo 28, 2026

---

## ARQUITECTURA

Cliente
   |
facturacion.squidapps.org (Cloudflare DNS + Worker failover)
   |
Cloudflare Worker (facturacion-failover)
   |
Railway responde en <5seg?
   SI  -> Railway PRIMARIO -> Neon PostgreSQL
   NO  -> Render FAILOVER (Starter 7 USD/mes, no duerme) -> Neon PostgreSQL

Monitoreo: UptimeRobot cada 5 min -> menandro1968@gmail.com

---

## URLs CRITICAS

| Servicio | URL |
|---|---|
| Produccion (publico) | https://facturacion.squidapps.org |
| Railway (primario) | https://facturacion-saas-production.up.railway.app |
| Render (failover) | https://facturacion-backend-znnn.onrender.com |
| Health check | /health |
| Ready check (con DB) | /ready |

---

## DASHBOARDS

| Recurso | URL |
|---|---|
| Railway | https://railway.app/dashboard (proyecto: intuitive-courage) |
| Render | https://dashboard.render.com (servicio: facturacion-backend) |
| Cloudflare DNS | https://dash.cloudflare.com -> squidapps.org -> DNS |
| Cloudflare Worker | https://dash.cloudflare.com -> Workers -> facturacion-failover |
| Neon DB | https://console.neon.tech (proyecto: quiet-truth-15477411) |
| UptimeRobot | https://dashboard.uptimerobot.com/monitors |
| GitHub repo | https://github.com/menandro68/facturacion-backend (branch: maestro) |

---

## ESCENARIOS DE INCIDENTES

### ESCENARIO 1: facturacion.squidapps.org devuelve 502/503/timeout

Diagnostico rapido (PowerShell):

    Invoke-WebRequest -Uri "https://facturacion.squidapps.org/health" -Method GET | Select-Object StatusCode
    Invoke-WebRequest -Uri "https://facturacion-saas-production.up.railway.app/health" -Method GET | Select-Object StatusCode
    Invoke-WebRequest -Uri "https://facturacion-backend-znnn.onrender.com/health" -Method GET | Select-Object StatusCode

Interpretacion:
- Si los 3 estan en 200 -> problema temporal de propagacion. Esperar 2-3 min.
- Si Railway 502 y Render 200 -> Worker debe estar haciendo failover automatico.
- Si Railway y Render fallan -> revisar Neon DB (escenario 3).

Accion:
1. Revisar logs del Worker: Cloudflare -> facturacion-failover -> Observabilidad.
2. Revisar deployments Railway: Railway -> facturacion-saas -> Deployments.
3. Si Railway tiene deploy fallido reciente -> rollback al ultimo deploy exitoso.

---

### ESCENARIO 2: Railway completamente caido (proveedor)

Diagnostico:
- Status: https://status.railway.com
- Multiples monitores UptimeRobot en rojo para *.up.railway.app.

Accion:
- El Worker debe estar enrutando automaticamente a Render (sin accion manual).
- Verificar Render funcionando: facturacion.squidapps.org/health debe dar 200.
- Si todo OK por Render -> esperar restauracion Railway, no tocar nada.
- Si Render tambien degradado -> escalar instance type en Render (Starter -> Standard).

---

### ESCENARIO 3: Neon PostgreSQL caido

Sintomas: /health responde 200 pero /ready responde 500.

Accion:
1. Verificar status Neon: https://neonstatus.com
2. Verificar dashboard Neon: console.neon.tech -> quiet-truth-15477411.
3. Si Neon caido -> no hay failover de DB. Esperar restauracion (SLA 99.95%).
4. Comunicar a clientes via status page o WhatsApp.

---

### ESCENARIO 4: Deploy de Railway fallo

Sintomas: Build/Deploy en rojo en Railway dashboard.

Accion:
1. Railway -> facturacion-saas -> Deployments -> ultimo fallido -> View logs.
2. Identificar error (build, env vars, runtime).
3. Si critico: rollback al ultimo deployment exitoso.
4. El Worker mantiene servicio activo via Render mientras se arregla Railway.

---

### ESCENARIO 5: Render dormido o lento

Sintomas: Primera request a facturacion-backend-znnn.onrender.com tarda 30-60 seg.

Verificacion:
- Render -> facturacion-backend -> debe mostrar plan Starter (NO Free).
- Si dice Free -> necesita upgrade a Starter (7 USD/mes) inmediatamente.

Accion: Plan Starter ya activo (mayo 2026). Si vuelve a Free por error de billing -> reactivar Starter.

---

### ESCENARIO 6: Cloudflare Worker dejo de funcionar

Sintomas: facturacion.squidapps.org no responde, pero backends directos si.

Diagnostico:
- Cloudflare -> Workers -> facturacion-failover -> Observabilidad.
- Probar URL directa: https://facturacion-failover.menandro1968.workers.dev/health

Accion:
1. Si Worker tiene errores de codigo -> revisar ultimo deploy y revertir.
2. Si Worker OK pero dominio no enruta -> Cloudflare DNS -> verificar Worker route.
3. Emergencia extrema: cambiar DNS facturacion a CNAME directo a Railway temporalmente.

---

### ESCENARIO 7: Certificado SSL expirado

Sintomas: Browser muestra NET::ERR_CERT_DATE_INVALID.

Accion:
- Cloudflare gestiona SSL automaticamente. Si expira -> Cloudflare -> SSL/TLS -> Edge Certificates -> forzar renovacion.

---

## COMANDOS DE EMERGENCIA

Verificar todo el stack rapido (PowerShell):

    Write-Host "=== PUBLICO ==="; Invoke-WebRequest "https://facturacion.squidapps.org/health" | Select StatusCode
    Write-Host "=== RAILWAY ==="; Invoke-WebRequest "https://facturacion-saas-production.up.railway.app/health" | Select StatusCode
    Write-Host "=== RENDER ==="; Invoke-WebRequest "https://facturacion-backend-znnn.onrender.com/health" | Select StatusCode

Probar failover manual (riesgo CONTROLADO):
1. Cloudflare -> facturacion-failover -> Editar codigo.
2. Cambiar const PRIMARY a URL invalida (ej: https://nonexistent-test-12345.example.invalid).
3. Desplegar.
4. Verificar facturacion.squidapps.org/health -> debe dar 200 (sirve desde Render).
5. REVERTIR INMEDIATAMENTE: restaurar PRIMARY a https://facturacion-saas-production.up.railway.app y desplegar.

---

## CONTACTOS Y RECURSOS

| Servicio | Recurso |
|---|---|
| Railway support | https://railway.app/help |
| Render support | https://render.com/docs/support |
| Cloudflare support | https://dash.cloudflare.com -> Soporte |
| Neon support | https://console.neon.tech -> Help |
| UptimeRobot | https://uptimerobot.com/contact |

---

## COSTOS MENSUALES FIJOS

| Servicio | Plan | Costo |
|---|---|---|
| Railway | Hobby (workspace) | 0 USD |
| Render | Starter instance | 7 USD/mes |
| Cloudflare | Free + Workers Free | 0 USD |
| Neon | Free tier | 0 USD |
| UptimeRobot | Free (6/50 monitores) | 0 USD |
| TOTAL | | 7 USD/mes |

Cobro automatico: Visa terminada en 2745.

---

## HISTORIAL DE INCIDENTES

| Fecha | Incidente | Resolucion | Tiempo |
|---|---|---|---|
| Sin incidentes registrados | | | |

---

Mantenido por: Menandro
Repo: github.com/menandro68/facturacion-backend
