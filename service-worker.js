self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith('ffx-web-')).map(k=>caches.delete(k)));
  await self.registration.unregister();
  await self.clients.claim();
  const clients=await self.clients.matchAll({type:'window'});
  for(const c of clients){try{c.postMessage({type:'FFX_SW_REMOVED'});}catch{}}
})()));
