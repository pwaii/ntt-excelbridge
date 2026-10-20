# Cognito hosted UI theme

The existing Cognito Classic sign-in and sign-up pages use the app's restored
white/gray and blue theme. The source is `infra/cognito-hosted-ui.css`:

- Primary action/focus: `#002fa7`; button hover: `#002684`.
- Form surface: `#f7f7f8`; banner/fields: white.
- Main text: `#202124`; supporting text: `#62656e`.
- Error: `#b42332`; valid password feedback: `#21613e`.

Only Cognito's supported selectors and properties are used. Cognito retains the
outer page layout, surrounding background, authentication messages and responsive
forms. This stylesheet changes branding, not registration or email verification.
No user account, password policy, OAuth flow or token validation is changed.

Apply from the repository root with the existing public app client's pool/client
IDs set in the shell (these IDs are public configuration, not AWS credentials):

```powershell
aws cognito-idp set-ui-customization `
  --user-pool-id $env:COGNITO_USER_POOL_ID `
  --client-id $env:COGNITO_APP_CLIENT_ID `
  --css file://infra/cognito-hosted-ui.css `
  --region us-east-1 --profile excelbridge
```

Customization is scoped to the app client and applies to its local and CloudFront
callbacks. It is applied through the Cognito API, not the frontend build. Preserve
any existing CSS and logo before replacing an established customization.

Desktop and mobile checks open both real Cognito forms without entering
credentials or submitting registration. Verify the applied button color, hover,
input focus and page width, then visually inspect the captures. These checks do
not establish completion of registration or email delivery.

[AWS Classic branding documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/hosted-ui-classic-branding.html)
