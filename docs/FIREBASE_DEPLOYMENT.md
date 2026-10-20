# Free-tier deployment

For a no-billing setup, use:

- Firebase Hosting on the Spark plan for the static React frontend.
- Render free web services for the Express API and Python AI service.
- MongoDB Atlas M0 for persistent data.

The frontend calls the Render API directly over HTTPS. Firebase Hosting does not proxy API
requests in this configuration, so no Google Cloud billing account or Cloud Run service is
needed. This is intended for a demo or light use, not production availability guarantees.

## Free-tier limitations

- Render free services can sleep while idle. The first request after idle can take a while;
  the frontend and API timeouts are extended for this cold start.
- Free services have limited CPU and memory. The AI model artifacts are included in the repo
  (about 2.2 MiB combined), but AI responses can still be slow.
- In-memory telemetry and analytics reset after a service restart. MongoDB-backed records
  persist.
- Firebase Hosting's Spark plan includes 10 GB stored content and 10 GB/month transfer.
  Reaching the no-cost transfer limit can disable the site until the next month.
- Atlas M0 has limited storage and network controls. Follow Atlas' current connection
  guidance; use a strong unique database password and minimum required database permissions.
  Some free hosting plans do not provide fixed outbound IPs. Do not put sensitive production
  data in the demo if Atlas requires a broad IP allowlist. Never expose database credentials
  in the frontend or chat.
- These providers can change their free-tier limits. Check their current pricing before
  deployment. Do not upgrade to a paid plan if you need to keep the cost at zero.

## One-time prerequisites

1. Create/select a Firebase project. Your console screenshot shows `chaitanya-8a97c` and
   `api-llm-vault`; use the project ID you intend to host this app under.
2. Keep the Firebase project on the Spark plan (do not add a billing account).
3. Create a GitHub repository and push this project to it. Render deploys from that repo.
4. Create a MongoDB Atlas M0 cluster and an application database user.
5. Install Firebase CLI and authenticate from PowerShell:

```powershell
npm install -g firebase-tools
firebase login
```

No Google Cloud CLI or billing account is required for this free-tier path.

## Deploy the backend on Render

In Render, create a **Blueprint** from the GitHub repository and select the root
`render.yaml`. It defines both services with `plan: free`:

- `machineguard-ai` (Python, health check `/health`)
- `machineguard-api` (Node, health check `/api/health`)

When prompted for environment values:

1. Enter an administrator password of 8–72 characters for `ADMIN_PASSWORD` and save it. Use
   it with `ADMIN_EMAIL` (`admin@maintai.dev`) on first login, then change it in the app.
2. Generate one random token locally, for example:

   ```powershell
   node -p "require('node:crypto').randomBytes(32).toString('hex')"
   ```

   Enter that same value for the AI service's `INTERNAL_API_TOKEN` and the API's
   `AI_SERVICE_TOKEN`. Do not send the token in chat.
3. Enter the Atlas URI for `MONGODB_URI` on the API service only.
4. Set `CLIENT_URL` to the Firebase Hosting origin(s), comma-separated and with no paths:
   `https://PROJECT_ID.web.app,https://PROJECT_ID.firebaseapp.com`
5. Keep the generated `JWT_SECRET`. The Blueprint configures `AI_SERVICE_URL` from the AI
   service automatically.

Let Render finish both deployments. Check the public service health endpoints:

```text
https://YOUR-AI-SERVICE.onrender.com/health
https://YOUR-API-SERVICE.onrender.com/api/health
```

The AI service health endpoint should report `status: ok`; the API endpoint should also
report `status: ok`.

## Deploy the frontend to Firebase Hosting

Use the Firebase project ID (not its display name) and API URL from Render:

```powershell
npm run deploy:firebase -- -ProjectId YOUR_FIREBASE_PROJECT_ID -ApiUrl https://YOUR-API-SERVICE.onrender.com/api
```

This script checks the API health endpoint, builds the client with the Render API URL, then
deploys `client/dist` to Firebase Hosting. It does not enable Cloud Run or billing. The site
will be at:

```text
https://YOUR_FIREBASE_PROJECT_ID.web.app
```

If using a custom domain, add its exact HTTPS origin to `CLIENT_URL` in Render and verify
the domain with Firebase Hosting before deploying.

## After deployment

- Sign in with the admin email/password you configured in Render.
- Confirm the dashboard loads, then try the AI question feature. The first request after
  idle may be slow because the free backend services wake up.
- Keep the project on Spark / free service plans to avoid charges. Monitor free-tier usage.
- For a future paid setup, Cloud Run + Firebase Hosting is available, but it requires a
  Google Cloud billing account and is not guaranteed to remain within the free usage tier.
