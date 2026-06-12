# Security Checklist

## Authentication
- [x] API keys are hashed (SHA-256) before storage
- [x] API keys are never logged
- [x] Rate limiting is active (100 req/15min)
- [x] Admin endpoints are protected via X-Admin-Secret
- [x] GitHub token stored in environment variables

## Docker Security
- [x] Containers run as non-root user (UID 1000)
- [x] Root filesystem is read-only
- [x] Resource limits enforced (CPU, memory, PIDs)
- [x] Capabilities dropped (cap_drop: ALL)
- [x] Selective capabilities added (CHOWN, DAC_OVERRIDE, SETGID, SETUID)
- [x] seccomp profile applied (seccomp:default)
- [x] AppArmor profile applied (apparmor:docker-default)
- [x] No privileged mode
- [x] no-new-privileges security option
- [x] Log rotation configured (10m max, 3 files)
- [x] tmpfs mounts with noexec,nosuid,nodev

## Input Validation
- [x] All inputs validated with Zod schemas
- [x] Path traversal prevented (../)
- [x] Command injection prevented ($, `, ;, |, &)
- [x] Dangerous commands blocked (rm, eval, exec)
- [x] File upload type whitelist (png, jpeg, gif, webp)
- [x] Prompt length validated
- [x] Repository URLs validated

## Secrets Management
- [x] API keys in environment variables
- [x] Secrets not hardcoded in source
- [x] Secrets not logged
- [x] Admin secret configurable per deployment
- [x] Webhook HMAC signatures

## Network Security
- [x] HTTPS enforced via Caddy reverse proxy
- [x] TLS 1.2+ required (Caddy default)
- [x] Security headers set (HSTS, CSP, X-Frame-Options, X-XSS-Protection)
- [x] CORS configurable per deployment
- [x] Referrer-Policy and Permissions-Policy headers

## Monitoring
- [x] Audit logging enabled (all requests recorded)
- [x] Failed authentication attempts logged
- [x] Resource usage monitored (memory, uptime)
- [x] Errors tracked in database
- [x] Prometheus-format metrics exported at /metrics

## Backup & Recovery
- [ ] Database backed up daily (manual configuration required)
- [ ] Backups encrypted (manual configuration required)
- [ ] Recovery procedure documented (see setup guide)
- [ ] Backups tested (manual verification required)

## Deployment Security
- [x] Server runs as non-root in production container
- [x] Docker socket mounted read-only
- [x] Server not directly exposed (behind Caddy)
- [x] Health checks configured
- [x] Auto-restart enabled (unless-stopped)
- [ ] SSL certificates via Let's Encrypt (requires domain configuration)
