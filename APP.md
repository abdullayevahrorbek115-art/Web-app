# Donat Shop ilovasi

Ilova bot bilan bir xil bazada ishlaydi: balans, buyurtmalar va narxlar umumiy.
Telefonda 2 xil usulda foydalanish mumkin.

## 1-usul: Brauzerdan o'rnatish (APK shart emas)

1. Botni Render'ga joylab, ishlayotganini tekshiring.
2. Telefonda Chrome'da `https://SIZNING-BOT.onrender.com/app/` ni oching.
3. Chrome menyusi (⋮) → "Bosh ekranga qo'shish" / "Ilovani o'rnatish".
4. Ilova bosh ekranda ikonka bo'lib chiqadi.

## 2-usul: APK fayl (GitHub o'zi yig'adi)

1. Loyihani GitHub'ga yuklang (`android-app` papkasi va `.github` papkasi bilan birga).
2. GitHub'da repo → **Actions** → **APK yig'ish** → **Run workflow**.
3. `app_url` ga bot manzilini yozing: `https://SIZNING-BOT.onrender.com` (oxirida `/` siz).
4. 5–10 daqiqadan keyin tugagach, ish ichidagi **donat-shop-apk** faylini yuklab oling (zip ichida `app-debug.apk`).
5. APK'ni oching. Telefon "noma'lum manba" ruxsatini so'rasa, ruxsat bering.

Eslatma: bu sinov (debug) APK. Play Market uchun emas, to'g'ridan-to'g'ri o'rnatish uchun.
Ilova ichida sahifa serverdan yuklanadi, shuning uchun bot yangilansa, APK'ni qayta yig'ish shart emas.

## Kirish

Botda **📱 Ilovaga kirish** tugmasini bosing (yoki `/app`). Bot 8 xonali kod beradi,
uni ilovaga kiriting. Kod 5 daqiqa amal qiladi va bir marta ishlaydi.

## Muhim

- Render bepul rejasi uxlab qoladi, ilova birinchi ochilganda 30–60 soniya kutishi mumkin.
- Bepul Render'da `db.json` yangilanishda o'chib ketishi mumkin. Doimiy disk yoki boshqa hosting kerak.
- Telegram Stars/Premium kabi tovarlarda ilova username so'raydi.
