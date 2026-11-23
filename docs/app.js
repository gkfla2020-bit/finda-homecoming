(() => {
  'use strict';

  // ── 설정 ────────────────────────────────────────────────
  // endpoint: Google Apps Script 웹 앱 주소 (…/exec). 비어 있으면 제출을 받지 않는다.
  // contactPhone: 회장 연락처 숫자만. 비어 있으면 전화·문자 버튼을 숨긴다.
  const CONFIG = {
    endpoint: 'https://script.google.com/macros/s/AKfycbwPfjZC_8yW2SlrpxKSSNEgQA1sdBVmx67O4lpFC8CeqSUuOBgTre_g0cEC0V_fUs_R/exec',
    contactPhone: '',
  };

  const EVENT_START = Date.UTC(2027, 0, 9, 9, 0, 0); // 2027-01-09 18:00 KST
  const EVENT_END = Date.UTC(2027, 0, 9, 12, 0, 0); // 2027-01-09 21:00 KST
  const ACCENT = '#D9C6A5';
  const INK = '#090D1C';
  const PAPER = '#F3F1EC';
  const LINE = 'rgba(243,241,236,0.16)';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const isMobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // ── 안내 메시지 ──────────────────────────────────────────
  const toastEl = $('[data-toast]');
  let toastTimer;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 2800);
  }

  // ── 카운트다운 ───────────────────────────────────────────
  const cdMessage = $('[data-cd-message]');
  const countMessage = cdMessage.innerHTML;
  let cdState = 'count';
  const pad = (n) => String(n).padStart(2, '0');

  function setAll(key, value) {
    for (const el of $$(`[data-cd="${key}"]`)) {
      if (el.textContent !== value) el.textContent = value;
    }
  }

  function setMessage(state, text) {
    if (cdState === state) return;
    cdState = state;
    if (state === 'count') cdMessage.innerHTML = countMessage;
    else cdMessage.textContent = text;
  }

  function tick() {
    const now = Date.now();
    let diff = Math.max(0, EVENT_START - now);
    const d = Math.floor(diff / 86400000);
    diff -= d * 86400000;
    const h = Math.floor(diff / 3600000);
    diff -= h * 3600000;
    const m = Math.floor(diff / 60000);
    diff -= m * 60000;
    const s = Math.floor(diff / 1000);

    if (now >= EVENT_END) setMessage('ended', '홈커밍데이가 마무리되었습니다. 함께해 주셔서 감사합니다');
    else if (now >= EVENT_START) setMessage('live', '지금 홈커밍데이가 진행되고 있습니다');
    else if (d === 0) setMessage('today', '홈커밍데이가 바로 오늘입니다');
    else setMessage('count');

    setAll('d', String(d));
    setAll('h', pad(h));
    setAll('m', pad(m));
    setAll('s', pad(s));
  }

  tick();
  setTimeout(() => {
    tick();
    setInterval(tick, 1000);
  }, 1000 - (Date.now() % 1000));

  // ── 길찾기 ──────────────────────────────────────────────
  for (const link of $$('[data-app-link]')) {
    link.addEventListener('click', (event) => {
      const app = link.dataset.appLink;
      if (!isMobile) {
        event.preventDefault();
        toast(`${app}은 휴대폰에서 열 수 있습니다`);
        return;
      }
      const timer = setTimeout(() => {
        if (document.visibilityState === 'visible') toast(`${app} 앱을 찾지 못했습니다`);
      }, 1600);
      document.addEventListener('visibilitychange', () => clearTimeout(timer), { once: true });
    });
  }

  // ── 문의 연락처 ─────────────────────────────────────────
  const phone = CONFIG.contactPhone.replace(/\D/g, '');
  if (phone) {
    $('[data-contact-tel]').href = `tel:${phone}`;
    $('[data-contact-sms]').href = `sms:${phone}`;
    const number = $('[data-contact-number]');
    number.textContent = phone.replace(/^(\d{2,3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
    number.hidden = false;
    $('[data-contact]').hidden = false;
  }

  // ── 자세히 보기 ─────────────────────────────────────────
  for (const button of $$('[data-open]')) {
    button.addEventListener('click', () => {
      const dialog = document.getElementById(button.dataset.open);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    });
  }
  for (const dialog of $$('dialog')) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  // ── 참석 여부 ───────────────────────────────────────────
  const form = $('#rsvp-form');
  const done = $('#rsvp-done');
  const nameInput = $('#a-name');
  const phoneInput = $('#a-phone');
  const agreeAll = $('#agree-all');
  const agreePrivacy = $('#agree-privacy');
  const agreeMarketing = $('#agree-marketing');
  const submitButton = $('#rsvp-submit');
  const attendanceButtons = $$('[data-att]');
  let attendance = 'yes';

  function paintAttendance() {
    for (const button of attendanceButtons) {
      const on = button.dataset.att === attendance;
      const filled = button.dataset.att === 'yes' ? ACCENT : PAPER;
      button.setAttribute('aria-pressed', String(on));
      button.style.background = on ? filled : 'transparent';
      button.style.color = on ? INK : PAPER;
      button.style.borderColor = on ? filled : LINE;
    }
  }

  for (const button of attendanceButtons) {
    button.addEventListener('click', () => {
      attendance = button.dataset.att;
      paintAttendance();
    });
  }

  function showError(input, show) {
    const message = document.getElementById(`${input.id}-error`);
    message.hidden = !show;
    input.setAttribute('aria-invalid', String(show));
  }

  nameInput.addEventListener('input', () => showError(nameInput, false));
  phoneInput.addEventListener('input', () => {
    const digits = phoneInput.value.replace(/\D/g, '').slice(0, 11);
    if (digits !== phoneInput.value) phoneInput.value = digits;
    showError(phoneInput, false);
  });

  agreeAll.addEventListener('change', () => {
    agreePrivacy.checked = agreeAll.checked;
    agreeMarketing.checked = agreeAll.checked;
    showError(agreePrivacy, false);
  });
  for (const box of [agreePrivacy, agreeMarketing]) {
    box.addEventListener('change', () => {
      agreeAll.checked = agreePrivacy.checked && agreeMarketing.checked;
      if (agreePrivacy.checked) showError(agreePrivacy, false);
    });
  }

  function validate() {
    const nameBad = nameInput.value.trim() === '';
    const phoneValue = phoneInput.value;
    const phoneBad = phoneValue !== '' && !/^0\d{8,10}$/.test(phoneValue);
    const consentBad = !agreePrivacy.checked;
    showError(nameInput, nameBad);
    showError(phoneInput, phoneBad);
    showError(agreePrivacy, consentBad);
    const first = nameBad ? nameInput : phoneBad ? phoneInput : consentBad ? agreePrivacy : null;
    if (first) first.focus({ preventScroll: false });
    return !first;
  }

  const newId = () =>
    (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  let submissionId = newId();
  let sending = false;

  function setSending(on) {
    sending = on;
    submitButton.disabled = on;
    submitButton.textContent = on ? '제출하는 중…' : '제출하기';
  }

  function showDone(updated) {
    $('#rsvp-done-title').textContent = updated ? '응답을 수정했습니다' : '제출이 완료되었습니다';
    $('#rsvp-done-text').innerHTML =
      attendance === 'yes'
        ? '소중한 응답 감사합니다.<br>1월 9일, 광화문 보사우러스에서 뵙겠습니다.'
        : '소중한 응답 감사합니다.<br>다음 자리에서 꼭 뵙겠습니다.';
    form.hidden = true;
    done.hidden = false;
    done.focus({ preventScroll: true });
  }

  $('#rsvp-edit').addEventListener('click', () => {
    done.hidden = true;
    form.hidden = false;
    nameInput.focus({ preventScroll: true });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending) return;
    if (form.elements.website.value) return;
    if (!validate()) {
      toast('입력 내용을 확인해 주세요');
      return;
    }
    if (!CONFIG.endpoint) {
      toast('참석 여부 접수를 준비하고 있습니다. 잠시 후 다시 시도해 주세요');
      return;
    }

    setSending(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const body = new URLSearchParams({
        id: submissionId,
        attendance,
        name: nameInput.value.trim(),
        phone: phoneInput.value,
        consent: String(agreePrivacy.checked),
        marketing: String(agreeMarketing.checked),
        website: '',
      });
      const response = await fetch(CONFIG.endpoint, { method: 'POST', body, signal: controller.signal });
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || 'rejected');
      showDone(Boolean(result.updated));
      submissionId = newId();
    } catch (error) {
      toast(
        error && error.name === 'AbortError'
          ? '응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요'
          : '제출하지 못했습니다. 잠시 후 다시 시도해 주세요',
      );
    } finally {
      clearTimeout(timeout);
      setSending(false);
    }
  });
})();
