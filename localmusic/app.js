'use strict';
// LocalMusic PWA: no analytics, ads, network APIs, or remote media URLs.
const $ = id => document.getElementById(id);
const DB_NAME = 'localmusic-offline-v1';
let db;
let tracks = [];
let playlists = [];
let selectedPlaylist = 'all';
let mode = 'normal';
let currentId = null;
let currentUrl = null;
let currentSongLoaded = false;
let menuTrackId = null;
let shuffledUpcoming = [];
let shuffledHistory = [];
let toastTimer;
const audio = $('audio');

function notify(message) {
  const box = $('toast');
  box.textContent = message;
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), 3300);
}
function dbOpen() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore('tracks', { keyPath: 'id' });
      database.createObjectStore('playlists', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function dbAction(store, method, data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, method === 'get' || method === 'getAll' ? 'readonly' : 'readwrite');
    const request = method === 'getAll' ? tx.objectStore(store).getAll()
      : method === 'get' ? tx.objectStore(store).get(data)
      : method === 'put' ? tx.objectStore(store).put(data)
      : tx.objectStore(store).delete(data);
    let result;
    request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || request.error);
    tx.onabort = () => reject(tx.error || new Error('Операция прервана'));
  });
}
function cleanName(name) { return name.replace(/\.mp3$/i, '').trim() || 'Без названия'; }
function shortSize(size) { return size < 1024 * 1024 ? `${(size / 1024).toFixed(0)} КБ` : `${(size / 1024 / 1024).toFixed(1)} МБ`; }
function formatTime(n) {
  if (!Number.isFinite(n) || n < 0) return '0:00';
  const secs = Math.floor(n);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}
function el(tag, className, textValue) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (textValue !== undefined) element.textContent = textValue;
  return element;
}
function getVisible() {
  const sorted = tracks.slice().sort((a, b) => a.addedAt - b.addedAt);
  if (selectedPlaylist === 'all') return sorted;
  const p = playlists.find(item => item.id === selectedPlaylist);
  return p ? sorted.filter(track => p.trackIds.includes(track.id)) : sorted;
}
function updateShuffle() { shuffledUpcoming = []; shuffledHistory = []; }
async function reloadLibrary() {
  tracks = await dbAction('tracks', 'getAll');
  playlists = await dbAction('playlists', 'getAll');
  playlists.sort((a, b) => a.createdAt - b.createdAt);
  renderLibrary();
}
function renderLibrary() {
  const bar = $('playlists-bar');
  bar.replaceChildren();
  const filters = [{ id: 'all', title: 'Все треки' }, ...playlists.map(p => ({ id: p.id, title: p.name }))];
  if (selectedPlaylist !== 'all' && !playlists.find(p => p.id === selectedPlaylist)) selectedPlaylist = 'all';
  for (const filter of filters) {
    const button = el('button', 'chip' + (selectedPlaylist === filter.id ? ' selected' : ''), filter.title);
    button.type = 'button';
    button.addEventListener('click', () => { selectedPlaylist = filter.id; updateShuffle(); renderLibrary(); });
    bar.append(button);
  }
  const visible = getVisible();
  $('list-title').textContent = selectedPlaylist === 'all' ? 'Все треки' : (playlists.find(p => p.id === selectedPlaylist)?.name || 'Плейлист');
  $('song-count').textContent = `${visible.length} ${visible.length === 1 ? 'трек' : 'треков'}`;
  const list = $('library-list');
  list.replaceChildren();
  if (visible.length === 0) {
    const info = el('div', 'empty');
    info.append(el('span', 'empty-icon', '♫'));
    info.append(el('div', '', tracks.length === 0 ? 'Библиотека пуста. Нажми «+», чтобы импортировать MP3.' : 'В этом плейлисте пока нет песен.'));
    list.append(info);
    return;
  }
  for (const song of visible) {
    const row = el('div', 'track' + (currentId === song.id ? ' active' : ''));
    const glyph = el('button', 'track-play', currentId === song.id && !audio.paused ? '❚❚' : '♪');
    glyph.type = 'button';
    glyph.setAttribute('aria-label', `Воспроизвести ${song.title}`);
    glyph.addEventListener('click', () => selectAndPlay(song.id));
    const titleButton = el('button', 'track-title');
    titleButton.type = 'button';
    const title = el('strong', '', song.title);
    const secondary = el('small', '', `${shortSize(song.size)} · MP3`);
    titleButton.append(title, secondary);
    titleButton.addEventListener('click', () => selectAndPlay(song.id));
    const more = el('button', 'more', '⋮');
    more.type = 'button';
    more.setAttribute('aria-label', `Действия с ${song.title}`);
    more.addEventListener('click', () => openTrackMenu(song.id));
    row.append(glyph, titleButton, more);
    list.append(row);
  }
}
function closeDialog(id) { const d = $(id); if (d.open) d.close(); }
function openActions() { $('actions-dialog').showModal(); }
function openTrackMenu(id) {
  const song = tracks.find(t => t.id === id);
  if (!song) return;
  menuTrackId = id;
  $('track-actions-title').textContent = song.title;
  const box = $('track-options');
  box.replaceChildren();
  for (const list of playlists) {
    if (list.trackIds.includes(id)) continue;
    const button = el('button', 'modal-action', `＋ В плейлист «${list.name}»`);
    button.type = 'button';
    button.addEventListener('click', async () => {
      list.trackIds.push(id);
      try { await dbAction('playlists', 'put', list); renderLibrary(); notify('Добавлено в плейлист'); }
      catch (err) { list.trackIds.pop(); notify('Не удалось обновить плейлист: ' + err.message); }
      closeDialog('track-dialog');
    });
    box.append(button);
  }
  if (selectedPlaylist !== 'all') {
    const remove = el('button', 'modal-action', '− Убрать из этого плейлиста');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      const list = playlists.find(p => p.id === selectedPlaylist);
      if (list) { list.trackIds = list.trackIds.filter(x => x !== id); await dbAction('playlists', 'put', list); }
      closeDialog('track-dialog'); updateShuffle(); renderLibrary(); notify('Убрано из плейлиста');
    });
    box.append(remove);
  }
  const del = el('button', 'modal-action', '🗑 Удалить MP3 из LocalMusic');
  del.type = 'button';
  del.addEventListener('click', async () => {
    closeDialog('track-dialog');
    if (!confirm(`Удалить «${song.title}» из LocalMusic? Исходный файл вне приложения не изменится.`)) return;
    try {
      await dbAction('tracks', 'delete', id);
      for (const p of playlists) {
        if (p.trackIds.includes(id)) { p.trackIds = p.trackIds.filter(x => x !== id); await dbAction('playlists', 'put', p); }
      }
      if (currentId === id) { resetPlayer(); }
      updateShuffle(); await reloadLibrary(); notify('MP3 удалён из LocalMusic');
    } catch (err) { notify('Не удалось удалить файл: ' + err.message); }
  });
  box.append(del);
  if (selectedPlaylist !== 'all') {
    const p = playlists.find(x => x.id === selectedPlaylist);
    if (p) {
      const footer = el('button', 'modal-action', `Удалить плейлист «${p.name}»`);
      footer.type = 'button';
      footer.addEventListener('click', async () => {
        closeDialog('track-dialog');
        if (!confirm(`Удалить плейлист «${p.name}»? Песни останутся в библиотеке.`)) return;
        await dbAction('playlists', 'delete', p.id);
        selectedPlaylist = 'all';
        await reloadLibrary(); notify('Плейлист удалён');
      });
      box.append(footer);
    }
  }
  $('track-dialog').showModal();
}
async function importFiles(files) {
  const accepted = Array.from(files).filter(f => /\.mp3$/i.test(f.name) && f.size > 0);
  if (!accepted.length) { notify('Выбери хотя бы один MP3-файл'); return; }
  let imported = 0;
  const now = Date.now();
  for (const [i, file] of accepted.entries()) {
    try {
      const item = { id: (crypto.randomUUID?.() || `${now}-${i}-${Math.random().toString(36).slice(2)}`), title: cleanName(file.name), size: file.size, addedAt: now + i, blob: file };
      await dbAction('tracks', 'put', item);
      imported++;
    } catch (err) {
      notify(`Сохранено ${imported} из ${accepted.length}. Недостаточно памяти? ${err?.message || err}`);
      break;
    }
  }
  $('file-input').value = '';
  await reloadLibrary();
  if (imported) notify(`Добавлено MP3: ${imported}. Храни оригиналы отдельно.`);
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
}
function updatePlayerUi() {
  const song = tracks.find(x => x.id === currentId);
  $('now-title').textContent = song?.title || 'Выбери MP3 в библиотеке';
  $('play-btn').textContent = audio.paused ? '▶' : '❚❚';
  $('play-btn').setAttribute('aria-label', audio.paused ? 'Воспроизвести' : 'Пауза');
  $('time-now').textContent = formatTime(audio.currentTime);
  $('time-total').textContent = formatTime(audio.duration);
  $('progress').value = Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.currentTime / audio.duration * 1000) : 0;
}
function resetPlayer() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
  currentId = null;
  currentSongLoaded = false;
  updatePlayerUi();
}
async function loadTrack(id) {
  const song = tracks.find(x => x.id === id);
  if (!song) return false;
  if (id === currentId && currentSongLoaded) return true;
  audio.pause();
  const item = await dbAction('tracks', 'get', id);
  if (!item?.blob) { notify('Файл MP3 не найден в памяти'); return false; }
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentId = id;
  currentUrl = URL.createObjectURL(item.blob);
  audio.src = currentUrl;
  audio.load();
  currentSongLoaded = true;
  if ('mediaSession' in navigator && 'MediaMetadata' in window) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: song.title, artist: 'LocalMusic', album: 'Офлайн библиотека' });
  }
  updatePlayerUi();
  renderLibrary();
  return true;
}
async function startPlayback() {
  if (!currentId) {
    const items = getVisible();
    if (!items.length) { notify('Добавь MP3 через кнопку «+»'); return; }
    await loadTrack(mode === 'reverse' ? items[items.length - 1].id : mode === 'shuffle' ? items[Math.floor(Math.random() * items.length)].id : items[0].id);
  }
  try { await audio.play(); }
  catch (_e) { notify('Нажми Play ещё раз — iOS может требовать отдельное нажатие'); }
  updatePlayerUi(); renderLibrary();
}
async function selectAndPlay(id) {
  try {
    if (currentId !== id) await loadTrack(id);
    if (audio.paused) await startPlayback(); else { audio.pause(); updatePlayerUi(); renderLibrary(); }
  } catch (err) { notify('Не удалось открыть MP3: ' + err.message); }
}
function randomized(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)); [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
async function advance(direction = 1, automatic = false) {
  const items = getVisible();
  if (!items.length) { resetPlayer(); return; }
  const ids = items.map(t => t.id);
  if (automatic && mode === 'one' && currentId) {
    audio.currentTime = 0;
    await startPlayback(); return;
  }
  let nextId;
  if (mode === 'shuffle') {
    if (direction < 0 && shuffledHistory.length) nextId = shuffledHistory.pop();
    else {
      if (currentId && !shuffledHistory.includes(currentId)) shuffledHistory.push(currentId);
      if (!shuffledUpcoming.length) shuffledUpcoming = randomized(ids.filter(id => id !== currentId));
      nextId = shuffledUpcoming.shift() || currentId || ids[0];
    }
  } else {
    const ordered = mode === 'reverse' ? ids.slice().reverse() : ids;
    const currentIndex = ordered.indexOf(currentId);
    const targetIndex = currentIndex < 0 ? 0 : currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= ordered.length) {
      if (mode === 'all' || !automatic) nextId = ordered[(targetIndex + ordered.length) % ordered.length];
      else { audio.pause(); audio.currentTime = 0; updatePlayerUi(); renderLibrary(); return; }
    } else nextId = ordered[targetIndex];
  }
  if (nextId) {
    const ok = await loadTrack(nextId);
    if (ok) await startPlayback();
  }
}
function bindEvents() {
  $('add-btn').addEventListener('click', openActions);
  document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => closeDialog(btn.dataset.close)));
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', event => { if (event.target === d) d.close(); });
  }
  $('import-option').addEventListener('click', () => { closeDialog('actions-dialog'); $('file-input').click(); });
  $('new-playlist-option').addEventListener('click', () => { closeDialog('actions-dialog'); $('playlist-name').value = ''; $('playlist-dialog').showModal(); });
  $('file-input').addEventListener('change', event => importFiles(event.target.files));
  $('playlist-form').addEventListener('submit', async event => {
    event.preventDefault();
    const name = $('playlist-name').value.trim();
    if (!name) return;
    try {
      const p = { id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, name, createdAt: Date.now(), trackIds: [] };
      await dbAction('playlists', 'put', p);
      closeDialog('playlist-dialog');
      selectedPlaylist = p.id;
      await reloadLibrary(); notify('Плейлист создан');
    } catch (err) { notify('Ошибка: ' + err.message); }
  });
  $('play-btn').addEventListener('click', () => {
    if (audio.paused) startPlayback();
    else { audio.pause(); updatePlayerUi(); renderLibrary(); }
  });
  $('prev-btn').addEventListener('click', () => advance(-1));
  $('next-btn').addEventListener('click', () => advance(1));
  $('mode-select').addEventListener('change', event => { mode = event.target.value; localStorage.setItem('localmusic-mode', mode); updateShuffle(); });
  $('progress').addEventListener('input', event => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = Number(event.target.value) / 1000 * audio.duration;
  });
  for (const type of ['timeupdate', 'durationchange', 'play', 'pause', 'loadedmetadata']) {
    audio.addEventListener(type, () => { updatePlayerUi(); if (type === 'play' || type === 'pause') renderLibrary(); });
  }
  audio.addEventListener('ended', () => advance(1, true));
  audio.addEventListener('error', () => notify('Не удалось воспроизвести MP3. Возможно, файл повреждён.'));
  if ('mediaSession' in navigator) {
    const actions = { play: () => startPlayback(), pause: () => audio.pause(), previoustrack: () => advance(-1), nexttrack: () => advance(1), seekto: detail => { if (Number.isFinite(detail.seekTime)) audio.currentTime = detail.seekTime; } };
    for (const [action, handler] of Object.entries(actions)) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch (_e) { /* unsupported by platform */ }
    }
  }
}
async function boot() {
  mode = localStorage.getItem('localmusic-mode') || 'normal';
  if (!['normal', 'one', 'all', 'shuffle', 'reverse'].includes(mode)) mode = 'normal';
  $('mode-select').value = mode;
  bindEvents();
  if (!('indexedDB' in window)) { notify('В этом браузере недоступна локальная база данных'); return; }
  try { db = await dbOpen(); await reloadLibrary(); }
  catch (err) { notify('Не удалось открыть локальное хранилище: ' + err.message); }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => notify('Офлайн-режим не включён: проверь HTTPS и перезагрузи страницу'));
  }
}
boot();
