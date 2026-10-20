# XLSX Data Workflow frontend

React + Vite + strict TypeScript, React Router, Tailwind CSS, React Hook Form and Zod.

Frontend implementation status, setup/environment instructions, API contracts,
authentication, tests, historical audits and remaining AWS verification are maintained
in **[SESSION_FRONTEND.md](../SESSION_FRONTEND.md)**.

## Quick start

Requires Node.js 22.18+ and npm. From this directory:

```powershell
npm.cmd ci
npm.cmd run dev
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

Copy `.env.example` to `.env.local` and configure public values for your environment.
See the session document before choosing Cognito or local development access. Never
put AWS credentials, JWTs or a client secret in Vite configuration.

The configured backend uses reviewed workflow segments. Without STATE_MACHINE_ARN,
the local backend uses copy mode. Real AWS/Cognito and browser smoke verification
remain pending; synthetic tests do not certify those services.


Frontend screens through Day 7 are connected to the integrated review and artifact
contracts. Real-service acceptance remains environment-dependent. Use the
[demo runbook](../docs/frontend-demo-runbook.md) and `npm.cmd run demo:verify` for a
deterministic component rehearsal with synthetic service boundaries.
