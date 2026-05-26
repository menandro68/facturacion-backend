# 🚨 INCIDENT RESPONSE — SistemaDeFacturacion

> Guía profesional para manejar incidentes en producción.
> **Última actualización:** Mayo 25, 2026

---

## 📋 ARQUITECTURA

Cliente → Cloudflare (facturacion.squidapps.org) → Railway PRIMARIO → Neon PostgreSQL
                                                 ↳ Render FAILOVER ↗

**Monitoreo:** UptimeRobot cada 5 min → menandro1968@gmail.com

---

## 🔗 URLs CRÍTICAS

| Servicio | URL |
|---|---|
| Producción | https://facturacion.squidapps.org |
| Railway (primario) | https://facturacion-saas-production.up.railway.app |
| Render (failover) | https://facturacion-backend-znnn.onrender.com |
| Health check | /health |
| Ready check (con DB) | /ready |

---

## 🆘 ESCENARIOS DE INCIDENTES

### ESCENARIO 1: Sitio devuelve 502/503