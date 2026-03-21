importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: 'AIzaSyAjMFRL2yCK7mgztDCEyMN2UcQaj6YgcXA',
  authDomain: 'conversa-23858.firebaseapp.com',
  projectId: 'conversa-23858',
  storageBucket: 'conversa-23858.firebasestorage.app',
  messagingSenderId: '932487823999',
  appId: '1:932487823999:web:9795983806f06d22c1754a'
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {}
  if (!title) return

  self.registration.showNotification(title, {
    body: body || '',
    icon: '/logo.png',
    silent: true
  })
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      if (list.length > 0) {
        list[0].focus()
      } else {
        clients.openWindow('/')
      }
    })
  )
})
