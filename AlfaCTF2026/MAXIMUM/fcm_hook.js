Java.perform(function() {
    var cls = Java.use("com.google.firebase.messaging.FirebaseMessagingService");
    cls.onMessageReceived.implementation = function(msg) {
        console.log("FCM MESSAGE:", msg.getData());
        return this.onMessageReceived(msg);
    };
});
