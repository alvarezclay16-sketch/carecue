// Where the CareCue server lives. In the browser it's the same origin (served at /app);
// inside the Android app it's the public HTTPS server.
window.CARECUE_API = window.Capacitor?.isNativePlatform?.() ? "https://98-86-85-249.sslip.io" : "";
