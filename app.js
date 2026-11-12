(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ST = {
    requested: 'جاري البحث عن سائق...', accepted: 'السائق في الطريق إليك', arrived: 'السائق وصل',
    in_progress: 'الرحلة جارية', completed: 'انتهت الرحلة', cancelled_by_rider: 'تم إلغاء الرحلة',
    cancelled_by_driver: 'ألغى السائق الرحلة', no_drivers_found: 'لا يوجد سائقون متاحون الآن',
  };
  const VT = { economy: 'اقتصادي', comfort: 'مريح', van: 'عائلي' };

  let token = sessionStorage.getItem('token');
  let role = sessionStorage.getItem('role');
  let socket = null, map = null;
  const mk = {};
  let me = { lat: 24.7136, lng: 46.6753 }, gps = false, sim = false;
  let ride = null, est = null, dest = null, vtype = 'economy', pay = 'cash', score = 5, busy = false;
  let offer = null, offerTimer = null, online = false, needVehicle = false, locTimer = null, watchId = null;

  // ---------- helpers ----------
  function toast(m) {
    const t = $('#toast'); t.textContent = m; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500);
  }
  async function api(path, method = 'GET', body) {
    const r = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let d = {};
    try { d = await r.json(); } catch (_) {}
    if (r.status === 401 && token) { logout(); throw new Error('انتهت الجلسة'); }
    if (!r.ok) throw new Error(d.error || 'حدث خطأ');
    return d;
  }
  function logout() { sessionStorage.clear(); location.reload(); }

  // ---------- auth ----------
  let regMode = false;
  function drawAuth() {
    $('#auth').innerHTML = `
      <h2>تطبيق الرحلات (نسخة تجريبية)</h2>
      ${regMode ? '<input id="f_name" placeholder="الاسم">' : ''}
      <input id="f_phone" type="tel" placeholder="رقم الهاتف">
      <input id="f_pass" type="password" placeholder="كلمة المرور (8 أحرف على الأقل)">
      ${regMode ? '<select id="f_role"><option value="rider">راكب</option><option value="driver">سائق</option></select><input id="f_license" placeholder="رقم الرخصة (للسائق)">' : ''}
      <button id="f_go">${regMode ? 'إنشاء حساب' : 'تسجيل الدخول'}</button>
      <a href="#" id="f_toggle">${regMode ? 'لدي حساب' : 'حساب جديد'}</a>
      <p class="err" id="f_err"></p>`;
    $('#f_toggle').onclick = (e) => { e.preventDefault(); regMode = !regMode; drawAuth(); };
    $('#f_go').onclick = submitAuth;
  }
  async function submitAuth() {
    const body = { phone: $('#f_phone').value.trim(), password: $('#f_pass').value };
    try {
      let d;
      if (regMode) {
        Object.assign(body, { name: $('#f_name').value.trim(), role: $('#f_role').value, license_no: $('#f_license').value.trim() });
        d = await api('/auth/register', 'POST', body);
      } else {
        d = await api('/auth/login', 'POST', body);
      }
      if (d.user.role === 'admin') throw new Error('هذا حساب مدير، استخدم لوحة الإدارة');
      token = d.accessToken; role = d.user.role;
      sessionStorage.setItem('token', token); sessionStorage.setItem('role', role);
      start();
    } catch (e) { $('#f_err').textContent = e.message; }
  }

  // ---------- map ----------
  function initMap() {
    if (map) return;
    map = L.map('map', { zoomControl: false }).setView([me.lat, me.lng], 14);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    map.on('click', (e) => {
      if (role === 'rider' && !ride) {
        dest = { lat: e.latlng.lat, lng: e.latlng.lng };
        setMarker('dest', dest.lat, dest.lng, '#dc2626');
        est = null; render(); estimate();
      } else if (role === 'driver' && sim) {
        setMe(e.latlng.lat, e.latlng.lng); emitLoc();
      }
    });
  }
  function setMarker(name, lat, lng, color) {
    if (mk[name]) { mk[name].setLatLng([lat, lng]); return; }
    mk[name] = L.circleMarker([lat, lng], { radius: 9, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(map);
  }
  function rmMarker(name) { if (mk[name]) { map.removeLayer(mk[name]); delete mk[name]; } }
  function setMe(lat, lng) { me = { lat, lng }; setMarker('me', lat, lng, '#2563eb'); }
  function locate() {
    return new Promise((res) => {
      if (!navigator.geolocation) return res(false);
      navigator.geolocation.getCurrentPosition(
        (p) => { setMe(p.coords.latitude, p.coords.longitude); map.setView([me.lat, me.lng], 15); res(true); },
        () => res(false), { enableHighAccuracy: true, timeout: 8000 });
    });
  }
  function syncRideMarkers() {
    if (ride) {
      setMarker('pick', ride.pickup_lat, ride.pickup_lng, '#16a34a');
      setMarker('dest', ride.dropoff_lat, ride.dropoff_lng, '#dc2626');
    }
  }
  function resetRide() {
    ride = null; est = null; dest = null; score = 5;
    ['pick', 'dest', 'drv'].forEach(rmMarker);
  }

  // ---------- realtime ----------
  function connect() {
    socket = io({ auth: { token } });
    socket.on('connect_error', () => toast('تعذر الاتصال اللحظي'));
    socket.on('ride:status_changed', async (d) => {
      if (offer && d.rideId === offer.rideId) clearOffer();
      if (ride && d.rideId === ride.id) await refreshRide();
    });
    socket.on('ride:driver_location', (d) => { if (role === 'rider') setMarker('drv', d.lat, d.lng, '#0ea5e9'); });
    socket.on('ride:new_request', (d) => {
      if (role !== 'driver') return;
      offer = d;
      setMarker('pick', d.pickup.lat, d.pickup.lng, '#16a34a');
      clearTimeout(offerTimer);
      offerTimer = setTimeout(clearOffer, (d.expires_in || 15) * 1000);
      render();
    });
  }
  function clearOffer() { offer = null; clearTimeout(offerTimer); if (!ride) rmMarker('pick'); render(); }
  async function refreshRide() {
    try { ride = (await api('/rides/' + ride.id)).ride; } catch (_) { return; }
    if (role === 'driver' && ride.status.startsWith('cancelled')) { toast('ألغى الراكب الرحلة'); resetRide(); }
    render();
  }

  // ---------- driver location sharing ----------
  function emitLoc() {
    if (socket && online) socket.emit('driver:location', { lat: me.lat, lng: me.lng, ...(ride ? { rideId: ride.id } : {}) });
  }
  function startSharing() {
    stopSharing();
    if (navigator.geolocation) watchId = navigator.geolocation.watchPosition((p) => { if (!sim) setMe(p.coords.latitude, p.coords.longitude); }, () => {}, { enableHighAccuracy: true });
    locTimer = setInterval(emitLoc, 4000);
  }
  function stopSharing() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null; clearInterval(locTimer); locTimer = null;
  }

  // ---------- rider calls ----------
  async function estimate() {
    if (!dest) return;
    try { est = await api('/rides/estimate', 'POST', { pickup: { lat: me.lat, lng: me.lng }, dropoff: dest, vehicle_type: vtype }); }
    catch (e) { est = null; toast(e.message); }
    render();
  }

  // ---------- actions ----------
  const ACT = {
    vt: (v) => { vtype = v; est = null; render(); estimate(); },
    star: (v) => { score = +v; render(); },
    async request() {
      if (busy) return; busy = true;
      try {
        const d = await api('/rides', 'POST', { pickup: { lat: me.lat, lng: me.lng }, dropoff: dest, vehicle_type: vtype, payment_method: pay });
        ride = d.ride; syncRideMarkers();
      } catch (e) { toast(e.message); }
      busy = false; render();
    },
    async topup() { try { await api('/wallet/topup', 'POST', { amount: 100 }); toast('تم شحن 100 (تجريبي)'); } catch (e) { toast(e.message); } },
    async cancel() { try { await api(`/rides/${ride.id}/cancel`, 'POST'); } catch (e) { toast(e.message); } resetRide(); render(); },
    async rate() { try { await api(`/rides/${ride.id}/rate`, 'POST', { score }); toast('شكراً لتقييمك'); } catch (e) { toast(e.message); } resetRide(); render(); },
    reset() { resetRide(); render(); },
    // driver
    async toggle() {
      try {
        if (!online) {
          await api('/drivers/status', 'PATCH', { status: 'online', lat: me.lat, lng: me.lng });
          online = true; needVehicle = false; startSharing();
        } else {
          await api('/drivers/status', 'PATCH', { status: 'offline' });
          online = false; stopSharing();
        }
      } catch (e) { if (/vehicle/i.test(e.message)) needVehicle = true; else toast(e.message); }
      render();
    },
    async saveVehicle() {
      try {
        await api('/drivers/vehicle', 'POST', { make: $('#v_make').value, model: $('#v_model').value, plate: $('#v_plate').value, color: $('#v_color').value, type: $('#v_type').value });
        needVehicle = false; toast('تم حفظ المركبة، اضغط للاتصال');
      } catch (e) { toast(e.message); }
      render();
    },
    async accept() {
      const id = offer.rideId; clearTimeout(offerTimer);
      try { ride = (await api(`/rides/${id}/accept`, 'POST')).ride; offer = null; syncRideMarkers(); }
      catch (e) { toast(e.message); offer = null; rmMarker('pick'); }
      render();
    },
    ignore() { clearOffer(); },
    async step(a) {
      try {
        const d = await api(`/rides/${ride.id}/${a}`, 'POST');
        if (a === 'complete') { toast('تمت الرحلة • الأجرة ' + d.ride.fare); resetRide(); } else ride = d.ride;
      } catch (e) { toast(e.message); }
      render();
    },
    sim() {
      if (sim && !navigator.geolocation) return toast('GPS غير متاح');
      sim = !sim; render();
    },
    async earn() {
      try { const d = await api('/drivers/earnings'); toast(`اليوم ${d.today} • الإجمالي ${d.total} • الرحلات ${d.rides}`); } catch (e) { toast(e.message); }
    },
  };

  // ---------- panels ----------
  function riderPanel() {
    if (ride) {
      const s = ride.status;
      if (s === 'completed') {
        return `<b>${ST[s]}</b><div>الأجرة ${esc(ride.fare)}</div>
          <div class="stars">${[1, 2, 3, 4, 5].map((i) => `<span data-act="star" data-v="${i}">${i <= score ? '★' : '☆'}</span>`).join('')}</div>
          <button data-act="rate">تقييم السائق</button>`;
      }
      if (s.startsWith('cancelled') || s === 'no_drivers_found') return `<b>${ST[s]}</b><button data-act="reset">حسناً</button>`;
      return `<b>${ST[s]}</b>
        ${ride.driver_name ? `<div>${esc(ride.driver_name)} ★${esc(ride.driver_rating)}<br>${esc(ride.make || '')} ${esc(ride.model || '')} • ${esc(ride.plate || '')}</div>` : ''}
        ${s !== 'in_progress' ? '<button class="sec" data-act="cancel">إلغاء الرحلة</button>' : ''}`;
    }
    if (!dest) return '<div>اضغط على الخريطة لاختيار وجهتك</div>';
    return `<div class="seg">${Object.entries(VT).map(([k, v]) => `<button class="${k === vtype ? 'on' : ''}" data-act="vt" data-v="${k}">${v}</button>`).join('')}</div>
      <div>${est ? `الأجرة ${esc(est.fare)} • ${esc(est.distance_km)} كم • ${esc(est.duration_min)} د${est.surge > 1 ? ` • ذروة ×${esc(est.surge)}` : ''}` : 'جاري حساب السعر...'}</div>
      <select data-bind="pay"><option value="cash" ${pay === 'cash' ? 'selected' : ''}>نقداً</option><option value="wallet" ${pay === 'wallet' ? 'selected' : ''}>المحفظة</option></select>
      ${pay === 'wallet' ? '<button class="sec" data-act="topup">شحن المحفظة 100 (تجريبي)</button>' : ''}
      <button data-act="request" ${est ? '' : 'disabled'}>اطلب رحلة</button>`;
  }
  function driverPanel() {
    if (needVehicle) {
      return `<b>سجّل مركبتك أولاً</b>
        <input id="v_make" placeholder="الصنع"><input id="v_model" placeholder="الموديل">
        <input id="v_plate" placeholder="رقم اللوحة"><input id="v_color" placeholder="اللون">
        <select id="v_type"><option value="economy">اقتصادي</option><option value="comfort">مريح</option><option value="van">عائلي</option></select>
        <button data-act="saveVehicle">حفظ</button>`;
    }
    let h = `<button class="${online ? 'on' : ''}" data-act="toggle" ${ride ? 'disabled' : ''}>${online ? 'متصل — اضغط للإيقاف' : 'غير متصل — اضغط للاتصال'}</button>`;
    if (offer) h += `<div class="offer"><b>طلب جديد</b><div>${esc(offer.fare)} • ${esc(offer.distance_km)} كم</div><div class="row"><button data-act="accept">قبول</button><button class="sec" data-act="ignore">تجاهل</button></div></div>`;
    if (ride) {
      const s = ride.status;
      const lab = { accepted: 'وصلت إلى الراكب', arrived: 'بدء الرحلة', in_progress: 'إنهاء الرحلة' }[s];
      const act = { accepted: 'arrived', arrived: 'start', in_progress: 'complete' }[s];
      h += `<div>الراكب: ${esc(ride.rider_name)} • ${esc(ride.fare)}</div>
        ${lab ? `<button data-act="step" data-v="${act}">${lab}</button>` : ''}
        ${['accepted', 'arrived'].includes(s) ? '<button class="sec" data-act="cancel">إلغاء الرحلة</button>' : ''}`;
    } else if (online && !offer) h += '<div>بانتظار الطلبات...</div>';
    h += `<div class="row"><button class="sec" data-act="sim">${sim ? 'محاكاة الموقع: مفعّلة (اضغط الخريطة)' : 'استخدام GPS'}</button><button class="sec" data-act="earn">الأرباح</button></div>`;
    return h;
  }
  function render() { $('#panel').innerHTML = role === 'driver' ? driverPanel() : riderPanel(); }

  // ---------- start ----------
  async function start() {
    $('#auth').hidden = true; $('#main').hidden = false;
    $('#who').textContent = role === 'driver' ? 'السائق' : 'الراكب';
    initMap(); connect();
    gps = await locate(); sim = !gps;
    if (!gps) setMe(me.lat, me.lng);
    try {
      const d = await api('/rides/active');
      if (d.ride) { ride = d.ride; syncRideMarkers(); socket.emit('ride:join', ride.id); if (role === 'driver') { online = true; startSharing(); } }
    } catch (_) {}
    render();
  }

  $('#panel').addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (el && ACT[el.dataset.act]) await ACT[el.dataset.act](el.dataset.v);
  });
  $('#panel').addEventListener('change', (e) => { if (e.target.dataset.bind === 'pay') { pay = e.target.value; render(); } });
  $('#logout').onclick = logout;

  if (token && role) start(); else drawAuth();
})();
