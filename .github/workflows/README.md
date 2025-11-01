# GitHub Actions Workflow - Firefox Add-ons Publishing

This workflow automatically builds and publishes your Firefox extension to the Mozilla Add-ons (AMO) platform.

## Setup Instructions

### 1. Get AMO API Credentials

1. Go to [Firefox Add-ons Developer Hub](https://addons.mozilla.org/developers/)
2. Navigate to **Developer Hub** → **API Credentials**
3. Create a new API key/secret pair
4. Copy both the **JWT Issuer** and **JWT Secret**

### 2. Add GitHub Secrets

Go to your GitHub repository:
1. Settings → Secrets and variables → Actions
2. Add the following secrets:

**Required:**
- `AMO_JWT_ISSUER` - Your AMO API JWT Issuer (the key)
- `AMO_JWT_SECRET` - Your AMO API JWT Secret (the secret)

**Optional:**
- `AMO_CHANNEL` - Submission channel: `unlisted` (default) or `listed`
  - `unlisted`: Extension won't appear in public search (good for testing)
  - `listed`: Extension will be publicly searchable (requires full review)

### 3. Workflow Triggers

The workflow triggers on:
- **Push to main/master branch** (when manifest.json or code changes)
- **GitHub Release** (when you publish a release)
- **Manual trigger** (Actions tab → Run workflow)

## What It Does

1. **Packages the extension**: Creates a clean ZIP excluding dev files
2. **Lints the extension**: Validates the extension structure
3. **Signs and submits**: Uses web-ext to sign and submit to AMO
4. **Uploads artifacts**: Saves the signed .xpi file as a GitHub artifact

## Notes

- First submission will require manual approval in AMO dashboard
- Updates can be automated after initial approval
- Unlisted channel allows faster testing without full review
- Listed channel requires full Mozilla review process

## Troubleshooting

If the workflow fails:
1. Check the Actions tab for detailed error messages
2. Verify your AMO API credentials are correct
3. Ensure your extension ID matches the one in AMO
4. Check that manifest.json is valid

