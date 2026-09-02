export async function onRequest(context) {
  const { request, env, next } = context;

  const expectedUser = env.SITE_USER;
  const expectedPass = env.SITE_PASS;

  const authHeader = request.headers.get("Authorization");

  if (authHeader && authHeader.startsWith("Basic ")) {
    const encoded = authHeader.split(" ")[1];
    const decoded = atob(encoded);
    const [user, pass] = decoded.split(":");

    if (user === expectedUser && pass === expectedPass) {
      return next();
    }
  }

  return new Response("Bu alana erişim için giriş yapmanız gerekiyor.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Giris Gerekli", charset="UTF-8"',
    },
  });
}
