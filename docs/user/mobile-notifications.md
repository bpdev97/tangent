# Mobile notifications

Sign in to T3 Connect, link your environments, and enable **Device Notifications** in **Settings → Notifications** to receive alerts when an agent finishes, fails, needs approval, or asks for input. Tap a notification to open its thread. Your environment must have agent activity publishing enabled.

Enable **Live Activity Updates** on iOS, **Agent Live Updates** on Android 16 and newer, or **Ongoing Agent Activity** on older Android versions to follow work without opening the app. Finished results remain visible for up to 15 minutes. You can dismiss an Android activity card without disabling alerts; turn off the same switch to stop future cards.

Ordinary alerts stay quiet while the mobile app is in the foreground. Ongoing activity continues to update. Viewing a thread on another device does not silence your phone's alerts.

Android notifications require Android 7.0 or newer and Google Play services. Android 16 and newer can promote ongoing activity to a Live Update, subject to system settings and device support. Other devices show a regular ongoing notification. If Live Updates don't appear on Android 16 or newer, check **Live Update Settings** in T3 Code's **Settings → Notifications**. Android 7's battery-saving modes can delay removal of expired cards.

Notification permission and Android notification channels are controlled in system Settings. Background delivery requires T3 Connect; a direct or Tailscale connection alone does not enable push notifications. The mobile app does not need to maintain a connection to your environment. Force-stopping the Android app in system Settings prevents push delivery until you open it again.

In Tangent, notifications work without T3 Connect through a self-hosted push relay. On each server, enter the relay URL and password in **Settings → General → Notifications** and use **Test connection**. Then enable **Device Notifications** on your iPhone. Live Activity updates use the same relay.

To keep your phone quiet while you are at your computer, set **Quiet phone after desktop activity** in the same place. Finished and failed threads then skip the phone for that long after you last used the desktop or web app; they still appear in the Live Activity. Approvals and input requests always come through. Choose **Off** to have finished and failed threads alert your phone even while you are at your computer.
