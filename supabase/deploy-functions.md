# Deploy Edge Functions

Jalankan perintah berikut untuk deploy semua Edge Functions ke Supabase:

```bash
npx supabase functions deploy broadcasts --project-ref znbyoixiavrvnhjryyqw
npx supabase functions deploy webhooks --project-ref znbyoixiavrvnhjryyqw
npx supabase functions deploy broadcasts-cancel-resume --project-ref znbyoixiavrvnhjryyqw
npx supabase functions deploy dashboard-stats --project-ref znbyoixiavrvnhjryyqw
npx supabase functions deploy auth-login --project-ref znbyoixiavrvnhjryyqw
npx supabase functions deploy cleanup-logs --project-ref znbyoixiavrvnhjryyqw
npx supabase functions deploy session-expire-check --project-ref znbyoixiavrvnhjryyqw
```

## Set Environment Variables di Supabase Dashboard

Pergi ke: Project Settings → Edge Functions → Secrets

Tambahkan:
- `GATEWAY_URL` = http://<IP-server-gateway>:3001
- `GATEWAY_API_KEY` = gateway-internal-secret-key-2025
- `WEBHOOK_HMAC_SECRET` = hmac-secret-whatsapp-crm-2025
