// ============================================================
// KONFIGURATION - Diese Werte musst du anpassen!
// ============================================================
const CLIENT_ID = '1078609561258-454vce6k8jpolsk2arm6urdov4vlvjpu.apps.googleusercontent.com';
// ============================================================

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/calendar';
// im Browser gemerkte Konto-Adresse (steht nicht im Code, da das Repo öffentlich ist)
const ACCOUNT_HINT_KEY = 'kalender.accountHint';

let tokenClient;
let gapiInitialized = false;
let gisInitialized  = false;
let editingEventId  = null;
let editingCalendarId = null;

// eventId -> calendarId mapping
const eventCalendarMap = {};

// aktiver Kalender-Filter (null = alle, MUSIC_FILTER = Musik-Ansicht)
let activeCalendarFilter = null;
// Unterfilter in der Musik-Ansicht (null = alle Musik-Termine)
let activeMusicKind = null;

// ------ Musik-Termine (erkannt am Anfang des Titels) ------

const MUSIC_FILTER = '__music__';
// Reihenfolge ist wichtig: 'ev.Pr.' muss vor 'Pr.' geprüft werden
const MUSIC_KINDS = [
  { kind: 'probe-ev', label: 'Probe (offen)', color: '#fdd663', text: '#202124', pattern: /^ev\.?\s*pr\./i },
  { kind: 'probe',    label: 'Probe',         color: '#f9ab00', text: '#202124', pattern: /^pr\./i },
  { kind: 'gig',      label: 'Gig',           color: '#d80404', text: 'white', pattern: /^gigs?\b/i },
  { kind: 'band',     label: 'Bandkalender',  color: '#ef6c00', text: 'white', pattern: null },
];

// Kalender (z. B. von anderen Bands importiert), deren Termine alle zur Musik zählen (Teil des Namens)
const MUSIC_CALENDAR_NAMES = ['funkhouser'];

function isMusicCalendar(calendar) {
  const name = ((calendar && calendar.summary) || '').toLowerCase();
  return MUSIC_CALENDAR_NAMES.some(n => name.includes(n));
}

// Art zuerst am Titelanfang (Pr./ev.Pr./Gig), in Musik-Kalendern auch am Stichwort, sonst 'band'
function musicKind(summary, calendar) {
  const title = (summary || '').trim();
  const found = MUSIC_KINDS.find(k => k.pattern && k.pattern.test(title));
  if (found) return found.kind;
  if (!isMusicCalendar(calendar)) return null;
  // In Musik-Kalendern genügt das Stichwort irgendwo im Titel ("Probe" vor "Gig/Konzert",
  // damit z. B. "Konzertprobe" als Probe zählt)
  if (/probe/i.test(title)) return 'probe';
  if (/gig|konzert/i.test(title)) return 'gig';
  return 'band';
}

function musicInfo(kind) {
  return MUSIC_KINDS.find(k => k.kind === kind);
}

// Kalender für Dropdown (nur owner/writer)
let writableCalendars = [];

// ------ Initialisierung ------

let gapiStarted = false;

function gapiLoaded() {
  if (gapiStarted) return;
  gapiStarted = true;
  gapi.load('client', async () => {
    await gapi.client.init({
      discoveryDocs: [DISCOVERY_DOC],
    });
    gapiInitialized = true;
    checkReady();
  });
}

window.onload = () => {
  const interval = setInterval(() => {
    // api.js wird async geladen und kann vor oder nach app.js fertig sein: hier selbst starten
    if (!gapiStarted && typeof gapi !== 'undefined' && gapi.load) gapiLoaded();
    if (!gisInitialized && typeof google !== 'undefined' && google.accounts) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (response) => {
          if (response.error) {
            console.error(response);
            return;
          }
          onSignedIn();
        },
      });
      gisInitialized = true;
      checkReady();
    }
    // erst aufhören, wenn beide Google-Bibliotheken gestartet sind
    if (gapiStarted && gisInitialized) clearInterval(interval);
  }, 100);
};

function checkReady() {
  if (gapiInitialized && gisInitialized) {
    if (gapi.client.getToken()) {
      onSignedIn();
    }
  }
}

// ------ Auth ------

function handleLogin() {
  if (!gapiInitialized || !gisInitialized) {
    alert('Bitte warte kurz, die API wird noch geladen...');
    return;
  }
  // hint: gemerktes Konto vorwählen, dann entfällt die Kontoauswahl (leer = Google fragt nach)
  tokenClient.requestAccessToken({ prompt: '', hint: localStorage.getItem(ACCOUNT_HINT_KEY) || '' });
}

function handleLogout() {
  const token = gapi.client.getToken();
  if (token) {
    google.accounts.oauth2.revoke(token.access_token);
    gapi.client.setToken('');
  }
  document.getElementById('btn-login').style.display = 'block';
  document.getElementById('btn-logout').style.display = 'none';
  document.getElementById('controls').style.display = 'none';
  document.getElementById('events-list').innerHTML = '';
  document.getElementById('info-text').textContent = 'Bitte melde dich an, um deine Termine zu sehen.';
  document.getElementById('info-text').style.display = 'block';
}

function onSignedIn() {
  document.getElementById('btn-login').style.display = 'none';
  document.getElementById('btn-logout').style.display = 'block';
  document.getElementById('controls').style.display = 'block';
  document.getElementById('info-text').style.display = 'none';
  loadEvents();
}

// ------ Alle Kalender + Termine laden ------

async function loadEvents() {
  const list = document.getElementById('events-list');
  list.innerHTML = '<li style="color:#666">Lade Kalender...</li>';

  try {
    // 1. Alle Kalender auflisten
    const calResponse = await gapi.client.calendar.calendarList.list();
    // die ID des Hauptkalenders ist die Konto-Adresse: für die nächste Anmeldung merken
    const primaryCal = (calResponse.result.items || []).find(cal => cal.primary);
    if (primaryCal) localStorage.setItem(ACCOUNT_HINT_KEY, primaryCal.id);
const calendars = (calResponse.result.items || []).filter(cal => {
      if (cal.accessRole === 'owner' || cal.accessRole === 'writer') return true;
      const name = (cal.summary || '').toLowerCase();
      const id   = (cal.id   || '').toLowerCase();
      if (isMusicCalendar(cal)) return true;
      if (name.includes('feiertag')) return true;
      if (name.includes('geburtstag') || id.includes('addressbook') || id.includes('contacts')) return true;
      return false;
    });

    const now = new Date();
    const inOneYear = new Date();
    inOneYear.setFullYear(now.getFullYear() + 1);

    // 2. Termine aus allen Kalendern laden (parallel)
    const allEventsPromises = calendars.map(cal =>
      gapi.client.calendar.events.list({
        calendarId: cal.id,
        timeMin: now.toISOString(),
        timeMax: inOneYear.toISOString(),
        showDeleted: false,
        singleEvents: true,
        maxResults: 100,
        orderBy: 'startTime',
      }).then(res => {
        let events = res.result.items || [];
        if (cal.primary) {
          events = events.filter(e => e.eventType !== 'birthday');
        }
        return { calendar: cal, events };
      }).catch(() => ({ calendar: cal, events: [] }))
    );

    const results = await Promise.all(allEventsPromises);

    // Geburtstags-Events aus dem Primärkalender als eigenen virtuellen Kalender behandeln
    const primaryResult = results.find(r => r.calendar.primary);
    const birthdayCal = {
      id: '__birthdays__',
      summary: 'Geburtstage',
      backgroundColor: '#16a765',
    };
    let birthdayEvents = [];
    if (primaryResult) {
      try {
        const primaryResponse = await gapi.client.calendar.events.list({
          calendarId: primaryResult.calendar.id,
          timeMin: now.toISOString(),
          timeMax: inOneYear.toISOString(),
          showDeleted: false,
          singleEvents: true,
          maxResults: 100,
          orderBy: 'startTime',
        });
        birthdayEvents = (primaryResponse.result.items || []).filter(e => e.eventType === 'birthday');
      } catch (e) {
        birthdayEvents = [];
      }
    }

    // 3. Alle Termine zusammenführen und nach Datum sortieren
    let allEvents = [];
    results.forEach(({ calendar, events }) => {
      events.forEach(event => {
        eventCalendarMap[event.id] = calendar.id;
        allEvents.push({ event, calendar });
      });
    });
    birthdayEvents.forEach(event => {
      eventCalendarMap[event.id] = birthdayCal.id;
      allEvents.push({ event, calendar: birthdayCal });
    });

    allEvents.sort((a, b) => {
      const dateA = new Date(a.event.start.dateTime || a.event.start.date);
      const dateB = new Date(b.event.start.dateTime || b.event.start.date);
      return dateA - dateB;
    });

    list.innerHTML = '';

    if (allEvents.length === 0) {
      list.innerHTML = '<li style="color:#666;text-align:center;margin-top:20px">Keine Termine gefunden.</li>';
      return;
    }

    writableCalendars = results.map(r => r.calendar).filter(c => c.accessRole === 'owner' || c.accessRole === 'writer');
    const calendarList = results.map(r => r.calendar);
    if (birthdayEvents.length > 0) calendarList.push(birthdayCal);
    const hasMusic = allEvents.some(({ event, calendar }) => musicKind(event.summary, calendar));
    activeCalendarFilter = null;
    activeMusicKind = null;
    renderCalendarButtons(calendarList, hasMusic);
    renderMusicFilter();
    allEvents.forEach(({ event, calendar }) => renderEvent(event, calendar));
    applyFilters();

  } catch (err) {
    list.innerHTML = `<li style="color:red">Fehler beim Laden: ${err.message}</li>`;
    console.error(err);
  }
}

function renderEvent(event, calendar) {
  const list = document.getElementById('events-list');
  const li = document.createElement('li');
  li.className = 'event-item';
  li.id = `event-${event.id}`;
  li.dataset.calendarId = calendar.id;

  const start = event.start.dateTime || event.start.date;
  const end   = event.end.dateTime   || event.end.date;

  const music = musicInfo(musicKind(event.summary, calendar));
  // Musik-Termine bekommen eine eigene Farbe (nur in dieser App, in Google ändert sich nichts)
  const calColor = music ? music.color : (calendar.backgroundColor || '#1a73e8');
  const calName  = calendar.primary ? 'Mein Kalender' : (calendar.summary || 'Kalender');
  // Termine aus einem Musik-Kalender zeigen nur den Kalendernamen, sonst 'Kalender · Art'
  const labelText = music && music.kind !== 'band' ? `${calName} · ${music.label}` : calName;
  // Importierte/geteilte Kalender mit nur Leserechten lassen sich nicht bearbeiten
  const readOnly = calendar.accessRole === 'reader' || calendar.accessRole === 'freeBusyReader';
  const labelColor = music ? music.text : 'white';

  li.style.borderLeftColor = calColor;
  if (music) li.dataset.music = music.kind;

  li.innerHTML = `
    <div class="event-info">
      <span class="cal-label" style="background:${calColor};color:${labelColor}">${escapeHtml(labelText)}</span>
      <h3>${escapeHtml(event.summary || '(Kein Titel)')}</h3>
      <p>${formatDateTime(start)} &ndash; ${formatDateTime(end)}</p>
      ${event.location    ? `<p style="margin-top:4px">📍 ${escapeHtml(event.location)}</p>` : ''}
      ${event.description ? `<p style="margin-top:4px">${escapeHtml(event.description)}</p>` : ''}
    </div>
    <div class="event-actions">
      ${readOnly ? '' : `<button class="btn-edit" onclick="openEditModal('${event.id}')">Bearbeiten</button>
      <button class="btn-delete" onclick="deleteEvent('${event.id}')">Loschen</button>`}
    </div>
  `;
  list.appendChild(li);
}

// ------ Kalender-Dropdown befüllen ------

function populateCalendarSelect(selectedId) {
  const select = document.getElementById('input-calendar');
  select.innerHTML = '';
  writableCalendars.forEach(cal => {
    const option = document.createElement('option');
    option.value = cal.id;
    option.textContent = cal.primary ? 'Mein Kalender' : (cal.summary || 'Kalender');
    if (cal.id === selectedId || (!selectedId && cal.primary)) option.selected = true;
    select.appendChild(option);
  });
}

// ------ Kalender-Filter Sidebar ------

function renderCalendarButtons(calendars, hasMusic) {
  const sidebar = document.getElementById('sidebar');
  sidebar.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.className = 'cal-filter-btn active';
  allBtn.textContent = 'Alle';
  allBtn.dataset.calendarId = '';
  allBtn.onclick = () => filterCalendar(null, allBtn);
  sidebar.appendChild(allBtn);

  if (hasMusic) {
    const musicBtn = document.createElement('button');
    musicBtn.className = 'cal-filter-btn';
    musicBtn.textContent = '🎵 Musik';
    musicBtn.dataset.calendarId = MUSIC_FILTER;
    musicBtn.style.borderLeftColor = '#e8710a';
    musicBtn.style.setProperty('--cal-color', '#e8710a');
    musicBtn.onclick = () => filterCalendar(MUSIC_FILTER, musicBtn);
    sidebar.appendChild(musicBtn);
  }

  calendars.forEach(cal => {
    if ((cal.summary || '').toLowerCase() === 'kalenderwochen') return;
    const color = cal.backgroundColor || '#1a73e8';
    const btn = document.createElement('button');
    btn.className = 'cal-filter-btn';
    btn.textContent = cal.primary ? 'Mein Kalender' : (cal.summary || 'Kalender');
    btn.dataset.calendarId = cal.id;
    btn.style.borderLeftColor = color;
    btn.style.setProperty('--cal-color', color);
    btn.onclick = () => filterCalendar(cal.id, btn);
    sidebar.appendChild(btn);
  });
}

function filterCalendar(calendarId, clickedBtn) {
  activeCalendarFilter = calendarId;

  document.querySelectorAll('.cal-filter-btn').forEach(b => b.classList.remove('active'));
  if (clickedBtn) clickedBtn.classList.add('active');

  activeMusicKind = null;
  renderMusicFilter();
  applyFilters();
}

function applyFilters() {
  const musicView = activeCalendarFilter === MUSIC_FILTER;
  document.querySelectorAll('#events-list .event-item').forEach(li => {
    let show;
    if (musicView) {
      show = !!li.dataset.music && (!activeMusicKind || li.dataset.music === activeMusicKind);
    } else {
      show = !activeCalendarFilter || li.dataset.calendarId === activeCalendarFilter;
    }
    li.style.display = show ? '' : 'none';
  });
  document.getElementById('music-filter').style.display = musicView ? '' : 'none';
}

// Unterfilter der Musik-Ansicht: Alle / Proben / offene Proben / Gigs, mit Anzahl
function renderMusicFilter() {
  const bar = document.getElementById('music-filter');
  bar.innerHTML = '';
  const items = [{ kind: null, label: 'Alle' }, ...MUSIC_KINDS];
  items.forEach(({ kind, label }) => {
    const count = document.querySelectorAll(
      kind ? `#events-list .event-item[data-music="${kind}"]` : '#events-list .event-item[data-music]'
    ).length;
    const btn = document.createElement('button');
    btn.className = 'music-kind-btn' + (kind === activeMusicKind ? ' active' : '');
    btn.textContent = `${label} (${count})`;
    btn.onclick = () => {
      activeMusicKind = kind;
      renderMusicFilter();
      applyFilters();
    };
    bar.appendChild(btn);
  });
}

// ------ Modal ------

function openModal() {
  editingEventId = null;
  editingCalendarId = null;
  document.getElementById('modal-title').textContent = 'Neuer Termin';
  document.getElementById('input-title').value = '';
  document.getElementById('input-location').value = '';
  document.getElementById('input-desc').value = '';
  document.getElementById('input-start').value = '';
  document.getElementById('input-end').value = '';
  document.getElementById('input-kw').value = '';
  document.getElementById('label-calendar').style.display = '';
  populateCalendarSelect(null);
  document.getElementById('modal').classList.remove('hidden');
}

function openEditModal(eventId) {
  const calendarId = eventCalendarMap[eventId] || 'primary';

  gapi.client.calendar.events.get({
    calendarId: calendarId,
    eventId: eventId,
  }).then(response => {
    const event = response.result;
    editingEventId = eventId;
    editingCalendarId = calendarId;

    document.getElementById('label-calendar').style.display = 'none';
    document.getElementById('modal-title').textContent = 'Termin bearbeiten';
    document.getElementById('input-title').value = event.summary || '';
    document.getElementById('input-location').value = event.location || '';
    document.getElementById('input-desc').value = event.description || '';
    document.getElementById('input-start').value = toLocalDateTimeInput(event.start.dateTime || event.start.date);
    document.getElementById('input-end').value   = toLocalDateTimeInput(event.end.dateTime   || event.end.date);
    updateKW();
    document.getElementById('modal').classList.remove('hidden');
  }).catch(err => {
    alert('Fehler beim Laden des Termins.');
    console.error(err);
  });
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  editingEventId = null;
  editingCalendarId = null;
}

// ------ Termin speichern ------

async function saveEvent() {
  const title    = document.getElementById('input-title').value.trim();
  const location = document.getElementById('input-location').value.trim();
  const desc     = document.getElementById('input-desc').value.trim();
  const start = document.getElementById('input-start').value;
  const end   = document.getElementById('input-end').value;

  if (!title || !start || !end) {
    alert('Bitte Titel, Start und Ende ausfüllen.');
    return;
  }

  if (new Date(start) >= new Date(end)) {
    alert('Das Ende muss nach dem Start liegen.');
    return;
  }

  const calendarId = editingCalendarId || document.getElementById('input-calendar').value || 'primary';

  const eventBody = {
    summary: title,
    location: location || undefined,
    description: desc,
    start: { dateTime: new Date(start).toISOString() },
    end:   { dateTime: new Date(end).toISOString() },
  };

  try {
    if (editingEventId) {
      // patch ändert nur die gesendeten Felder (Teilnehmer, Erinnerungen, Meet-Link usw. bleiben);
      // location: '' leert das Feld, date: null entfernt den Ganztags-Wert beim Wechsel auf Uhrzeit
      await gapi.client.calendar.events.patch({
        calendarId: calendarId,
        eventId: editingEventId,
        resource: {
          ...eventBody,
          location: location,
          start: { ...eventBody.start, date: null },
          end:   { ...eventBody.end,   date: null },
        },
      });
    } else {
      await gapi.client.calendar.events.insert({
        calendarId: calendarId,
        resource: eventBody,
      });
    }
    closeModal();
    loadEvents();
  } catch (err) {
    alert('Fehler beim Speichern: ' + err.message);
    console.error(err);
  }
}

// ------ Termin loschen ------

async function deleteEvent(eventId) {
  if (!confirm('Termin wirklich loschen?')) return;

  const calendarId = eventCalendarMap[eventId] || 'primary';

  try {
    await gapi.client.calendar.events.delete({
      calendarId: calendarId,
      eventId: eventId,
    });
    const el = document.getElementById(`event-${eventId}`);
    if (el) el.remove();
  } catch (err) {
    alert('Fehler beim Loschen: ' + err.message);
    console.error(err);
  }
}

// ------ Hilfsfunktionen ------

function formatDateTime(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString);
  if (isNaN(d)) return dateString;
  return d.toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function toLocalDateTimeInput(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString);
  if (isNaN(d)) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getKW(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function updateKW() {
  const val = document.getElementById('input-start').value;
  const kwField = document.getElementById('input-kw');
  if (!val) { kwField.value = ''; return; }
  const d = new Date(val);
  if (isNaN(d)) { kwField.value = ''; return; }
  kwField.value = `KW ${getKW(d)} / ${d.getFullYear()}`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
