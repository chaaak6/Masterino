import { type NextRequest } from 'next/server';

import { appEnv } from '@/envs/app';

export const GET = async (request: NextRequest) => {
  const callbackUrl = request.nextUrl.searchParams.get('callbackUrl') || '/';

  const baseUrl = appEnv.APP_URL;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
<title>MasterLion</title>
</head>
<body>
<script>
(function(){
  var t = Date.now();
  var callbackUrl = ${JSON.stringify(callbackUrl)};
  fetch(${JSON.stringify(`${baseUrl}/api/auth/sign-in/oauth2`)} + "?_t=" + t, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId: 'wecom', callbackURL: callbackUrl })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.url) {
      window.location.replace(data.url);
    } else {
      window.location.replace(${JSON.stringify(`${baseUrl}/auth-error?error=wecom_workbench_no_auth_url`)});
    }
  })
  .catch(function() {
    window.location.replace(${JSON.stringify(`${baseUrl}/auth-error?error=wecom_workbench_init_failed`)});
  });
})();
</script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
    },
  });
};
