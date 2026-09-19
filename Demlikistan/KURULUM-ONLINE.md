# Demlik Online

Bu proje `Demlikistan` klasörünün içindedir. Railway servisinde Root Directory değerini `/Demlikistan` yapın.

1. Railway'de bu klasörü servis olarak deploy edin.
2. PostgreSQL servisini ekleyin ve `DATABASE_URL` değişkenini Demlik servisine bağlayın.
3. `DEMLIK_ADMIN_PASSWORD` değişkenini güçlü bir admin parolasıyla ayarlayın.
4. Oyun: `/günceldata.html`
5. Canlı oyuncu paneli: `/admin.html`
6. Sağlık kontrolü: `/health`

Yerelde:

```powershell
npm install
$env:DATABASE_URL = "postgresql://..."
$env:DEMLIK_ADMIN_PASSWORD = "..."
npm start
```

Oyun `file://` ile açılırsa yerel oynanış çalışır ancak PostgreSQL senkronizasyonu çalışmaz. Online kayıt için Railway adresinden açılmalıdır.
