(() => {
const API_BASE = '/api';

const escapeHtml = (unsafe) => {
  if (typeof unsafe !== 'string') return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const buildNativeChatbot = () => {
  // Inject the floating shell if it doesn't exist
  let shell = document.querySelector('.native-chatbot-shell');
  if (!shell) {
    shell = document.createElement('div');
    shell.className = 'native-chatbot-shell floating-assistant';
    shell.innerHTML = `
      <button class="assistant-toggle" type="button" aria-expanded="false" aria-controls="chatbotPanel" aria-label="Abrir asistente de admisión">
        <i class="fa-solid fa-clipboard-user" aria-hidden="true"></i>
        <i class="fa-solid fa-xmark d-none" aria-hidden="true"></i>
      </button>
      <section class="assistant-chat" id="chatbotPanel" hidden>
        <header class="assistant-header">
          <i class="fa-solid fa-robot" aria-hidden="true"></i>
          <div>
            <strong>Admisión Digital</strong>
            <small>PhysioSafe Bot</small>
          </div>
        </header>
        <section class="chatbot-messages" id="chatbotMessages" aria-live="polite"></section>
        <section class="chatbot-input-area" id="chatbotInputArea"></section>
      </section>
    `;
    document.body.appendChild(shell);

    const toggle = shell.querySelector('.assistant-toggle');
    const panel = shell.querySelector('.assistant-chat');
    toggle.addEventListener('click', () => {
      const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', !isExpanded);
      panel.hidden = isExpanded;
      toggle.querySelector('.fa-clipboard-user').classList.toggle('d-none', !isExpanded);
      toggle.querySelector('.fa-xmark').classList.toggle('d-none', isExpanded);
      if (!isExpanded && chatbotFlow === 'idle') {
        startChatbot();
      }
    });
  }

  const messagesContainer = document.querySelector('#chatbotMessages');
  const inputArea = document.querySelector('#chatbotInputArea');
  if (!messagesContainer || !inputArea) return;

  let chatbotPhysios = [];
  let chatbotData = {};
  let chatbotFlow = 'idle'; // idle | full | contact | done

  const STEPS_FULL = [
    'consent', 'name', 'email', 'phone', 'reason', 'area', 'pain', 'urgency', 'redflags', 'physio', 'availability', 'confirm'
  ];
  const STEPS_CONTACT = [
    'consent', 'name', 'email', 'phone', 'reason_brief', 'physio', 'confirm_contact'
  ];
  let currentStepIndex = 0;

  const getCurrentSteps = () => chatbotFlow === 'contact' ? STEPS_CONTACT : STEPS_FULL;

  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  // ── Message rendering ──────────────────────────────────────────────────

  const addBotMessage = (html, extraClass = '') => {
    const msg = document.createElement('article');
    msg.className = \`chatbot-msg chatbot-msg--bot \${extraClass}\`.trim();
    msg.innerHTML = \`<i class="fa-solid fa-robot chatbot-msg__icon" aria-hidden="true"></i><div class="chatbot-msg__bubble">\${html}</div>\`;
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return msg;
  };

  const addUserMessage = (text) => {
    const msg = document.createElement('article');
    msg.className = 'chatbot-msg chatbot-msg--user';
    msg.innerHTML = \`<div class="chatbot-msg__bubble">\${escapeHtml(text)}</div>\`;
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  };

  const showTyping = () => {
    const typing = document.createElement('article');
    typing.className = 'chatbot-msg chatbot-msg--bot chatbot-typing';
    typing.innerHTML = \`<i class="fa-solid fa-robot chatbot-msg__icon" aria-hidden="true"></i><div class="chatbot-msg__bubble"><span class="chatbot-dots"><span></span><span></span><span></span></span></div>\`;
    messagesContainer.appendChild(typing);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return typing;
  };

  const removeTyping = () => {
    const typing = messagesContainer.querySelector('.chatbot-typing');
    if (typing) typing.remove();
  };

  // ── Input controls ─────────────────────────────────────────────────────

  const clearInput = () => {
    inputArea.innerHTML = '';
  };

  const showTextInput = (placeholder, onSubmit) => {
    clearInput();
    const form = document.createElement('form');
    form.className = 'chatbot-text-form';
    form.innerHTML = \`
      <input class="chatbot-text-input" type="text" placeholder="\${escapeHtml(placeholder)}" autocomplete="off" required>
      <button class="chatbot-send-btn" type="submit" aria-label="Enviar"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i></button>
    \`;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector('input');
      const val = input.value.trim();
      if (!val) return;
      addUserMessage(val);
      clearInput();
      onSubmit(val);
    });
    inputArea.appendChild(form);
    requestAnimationFrame(() => form.querySelector('input')?.focus());
  };

  const showEmailInput = (placeholder, onSubmit) => {
    clearInput();
    const form = document.createElement('form');
    form.className = 'chatbot-text-form';
    form.innerHTML = \`
      <input class="chatbot-text-input" type="email" placeholder="\${escapeHtml(placeholder)}" autocomplete="off" required>
      <button class="chatbot-send-btn" type="submit" aria-label="Enviar"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i></button>
    \`;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector('input');
      const val = input.value.trim();
      if (!val || !input.checkValidity()) {
        input.reportValidity();
        return;
      }
      addUserMessage(val);
      clearInput();
      onSubmit(val);
    });
    inputArea.appendChild(form);
    requestAnimationFrame(() => form.querySelector('input')?.focus());
  };

  const showChoices = (options, onSelect) => {
    clearInput();
    const nav = document.createElement('nav');
    nav.className = 'chatbot-choices';
    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'chatbot-choice-btn';
      btn.type = 'button';
      if (opt.icon) {
        btn.innerHTML = \`<i class="fa-solid \${escapeHtml(opt.icon)}" aria-hidden="true"></i> \${escapeHtml(opt.label)}\`;
      } else {
        btn.textContent = opt.label;
      }
      btn.addEventListener('click', () => {
        addUserMessage(opt.label);
        clearInput();
        onSelect(opt.value, opt.label);
      });
      nav.appendChild(btn);
    });
    inputArea.appendChild(nav);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  };

  const showPhysioSelector = (physios, onSelect) => {
    clearInput();
    const nav = document.createElement('nav');
    nav.className = 'chatbot-choices chatbot-choices--physios';
    physios.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'chatbot-choice-btn chatbot-choice-btn--physio';
      btn.type = 'button';
      btn.innerHTML = \`<i class="fa-solid fa-user-doctor" aria-hidden="true"></i> <strong>\${escapeHtml(p.name)}</strong>\`;
      btn.addEventListener('click', () => {
        addUserMessage(p.name);
        clearInput();
        onSelect(p);
      });
      nav.appendChild(btn);
    });
    inputArea.appendChild(nav);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  };

  // ── Load physios ───────────────────────────────────────────────────────

  const loadChatbotPhysios = async () => {
    try {
      const res = await fetch(\`\${API_BASE}/typebot/active-physios\`, {
        headers: { Accept: 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        chatbotPhysios = data.physiotherapists || [];
      }
    } catch (e) {
      chatbotPhysios = [];
    }
  };

  // ── Step execution ─────────────────────────────────────────────────────

  const advanceStep = async () => {
    const steps = getCurrentSteps();
    currentStepIndex += 1;
    if (currentStepIndex < steps.length) {
      await delay(400);
      const typing = showTyping();
      await delay(600 + Math.random() * 400);
      removeTyping();
      await runStep(steps[currentStepIndex]);
    }
  };

  const runStep = async (stepName) => {
    switch (stepName) {
      case 'consent':
        addBotMessage('Hola, soy el asistente de admision de <strong>PhysioSafe</strong>. Voy a preparar tus datos para que el equipo tenga todo listo antes de la primera cita.');
        await delay(800);
        addBotMessage('No sustituyo una valoracion sanitaria. Si tienes dolor incapacitante, fiebre, perdida de fuerza o adormecimiento progresivo, contacta con urgencias.', 'chatbot-msg--warning');
        await delay(600);
        addBotMessage('¿Como quieres continuar?');
        showChoices([
          { label: 'Acepto, completar admision', value: 'full', icon: 'fa-clipboard-check' },
          { label: 'Prefiero que me contacte la clinica', value: 'contact', icon: 'fa-phone' }
        ], async (val) => {
          if (val === 'contact') {
            chatbotFlow = 'contact';
            chatbotData.privacyConsent = 'Prefiere contacto clinica';
          } else {
            chatbotFlow = 'full';
            chatbotData.privacyConsent = 'Acepta admision digital';
          }
          currentStepIndex = 0; // consent is step 0
          await advanceStep();
        });
        break;

      case 'name':
        addBotMessage('¿Cual es tu <strong>nombre completo</strong>?');
        showTextInput('Nombre y apellidos', async (val) => {
          chatbotData.name = val;
          await advanceStep();
        });
        break;

      case 'email':
        addBotMessage('¿Cual es tu <strong>email</strong> de contacto?');
        showEmailInput('tu@email.com', async (val) => {
          chatbotData.email = val;
          await advanceStep();
        });
        break;

      case 'phone':
        addBotMessage('¿Tu <strong>telefono</strong> de contacto?');
        showTextInput('612 345 678', async (val) => {
          chatbotData.phone = val;
          await advanceStep();
        });
        break;

      case 'reason':
        addBotMessage('¿Cual es el <strong>motivo principal</strong> de tu consulta?');
        showTextInput('Describe brevemente tu motivo', async (val) => {
          chatbotData.reason = val;
          await advanceStep();
        });
        break;

      case 'reason_brief':
        addBotMessage('¿Puedes indicar <strong>brevemente</strong> el motivo por el que quieres que te contactemos?');
        showTextInput('Motivo breve', async (val) => {
          chatbotData.reason = val;
          await advanceStep();
        });
        break;

      case 'area':
        addBotMessage('¿Que <strong>zona del cuerpo</strong> esta afectada?');
        showTextInput('Ej: rodilla derecha, lumbar, hombro...', async (val) => {
          chatbotData.area = val;
          await advanceStep();
        });
        break;

      case 'pain':
        addBotMessage('¿Como describirias tu <strong>nivel de dolor</strong>?');
        showChoices([
          { label: 'Sin dolor / prevencion', value: 'No tengo dolor, busco prevencion o seguimiento', icon: 'fa-face-smile' },
          { label: 'Dolor leve', value: 'Dolor leve', icon: 'fa-face-meh' },
          { label: 'Dolor moderado', value: 'Dolor moderado', icon: 'fa-face-frown' },
          { label: 'Dolor intenso', value: 'Dolor intenso', icon: 'fa-face-dizzy' }
        ], async (val) => {
          chatbotData.pain = val;
          await advanceStep();
        });
        break;

      case 'urgency':
        addBotMessage('¿Que tan <strong>urgente</strong> consideras tu caso?');
        showChoices([
          { label: 'Puede esperar unos dias', value: 'Puede esperar unos dias', icon: 'fa-clock' },
          { label: 'Quiero que me valoren pronto', value: 'Quiero que me valoren pronto', icon: 'fa-bolt' },
          { label: 'Necesito revision urgente', value: 'Necesito revision urgente', icon: 'fa-circle-exclamation' }
        ], async (val) => {
          chatbotData.urgency = val;
          await advanceStep();
        });
        break;

      case 'redflags':
        addBotMessage('¿Presentas alguna de estas <strong>senales de alerta</strong>?');
        showChoices([
          { label: 'Ninguna de estas', value: 'Ninguna de estas', icon: 'fa-check' },
          { label: 'Perdida de fuerza / hormigueo progresivo', value: 'Perdida de fuerza, hormigueo o adormecimiento progresivo', icon: 'fa-hand' },
          { label: 'Traumatismo o caida reciente', value: 'Traumatismo importante o caida reciente', icon: 'fa-person-falling' },
          { label: 'Fiebre / mal estado general', value: 'Fiebre, mal estado general o dolor nocturno intenso', icon: 'fa-thermometer-full' },
          { label: 'Perdida de control de esfinteres', value: 'Perdida de control de esfinteres', icon: 'fa-triangle-exclamation' }
        ], async (val) => {
          chatbotData.redFlags = val;
          if (val !== 'Ninguna de estas') {
            await delay(400);
            const t = showTyping();
            await delay(800);
            removeTyping();
            addBotMessage('<strong>Atencion:</strong> has indicado una senal de alerta. Si la situacion es grave, no esperes y contacta con urgencias o tu medico. Vamos a marcar tu admision como <strong>revision prioritaria</strong>.', 'chatbot-msg--warning');
            await delay(600);
          }
          await advanceStep();
        });
        break;

      case 'physio':
        if (!chatbotPhysios.length) {
          await loadChatbotPhysios();
        }
        if (chatbotPhysios.length > 1) {
          addBotMessage('Elige el <strong>fisioterapeuta</strong> con el que quieres la cita:');
          showPhysioSelector(chatbotPhysios, async (physio) => {
            chatbotData.physiotherapistId = physio.id;
            chatbotData.physiotherapistEmail = physio.email;
            chatbotData._physioName = physio.name;
            await advanceStep();
          });
        } else if (chatbotPhysios.length === 1) {
          const physio = chatbotPhysios[0];
          chatbotData.physiotherapistId = physio.id;
          chatbotData.physiotherapistEmail = physio.email;
          chatbotData._physioName = physio.name;
          await advanceStep();
        } else {
          addBotMessage('No hay fisioterapeutas activos en el sistema. Se asignara uno automaticamente.');
          chatbotData.physiotherapistId = '';
          chatbotData.physiotherapistEmail = '';
          chatbotData._physioName = 'Asignacion automatica';
          await advanceStep();
        }
        break;

      case 'availability':
        addBotMessage('¿Que <strong>franja horaria</strong> prefieres?');
        showChoices([
          { label: 'Manana', value: 'Manana', icon: 'fa-sun' },
          { label: 'Tarde', value: 'Tarde', icon: 'fa-moon' },
          { label: 'Indiferente', value: 'Indiferente', icon: 'fa-clock' }
        ], async (val) => {
          chatbotData.availability = val;
          await advanceStep();
        });
        break;

      case 'confirm': {
        const hasRedFlag = chatbotData.redFlags && chatbotData.redFlags !== 'Ninguna de estas';
        const priority = hasRedFlag || (chatbotData.pain && chatbotData.pain.includes('intenso')) || (chatbotData.urgency && chatbotData.urgency.includes('urgente'))
          ? 'Revision prioritaria' : 'Normal';

        let summary = \`<strong>Resumen de tu admision:</strong><br>\`;
        summary += \`<span class="chatbot-summary-field"><i class="fa-solid fa-user"></i> \${escapeHtml(chatbotData.name)}</span>\`;
        summary += \`<span class="chatbot-summary-field"><i class="fa-solid fa-envelope"></i> \${escapeHtml(chatbotData.email)}</span>\`;
        summary += \`<span class="chatbot-summary-field"><i class="fa-solid fa-phone"></i> \${escapeHtml(chatbotData.phone)}</span>\`;
        summary += \`<span class="chatbot-summary-field"><i class="fa-solid fa-comment-medical"></i> \${escapeHtml(chatbotData.reason)}</span>\`;
        if (chatbotData.area) summary += \`<span class="chatbot-summary-field"><i class="fa-solid fa-person-dots-from-line"></i> \${escapeHtml(chatbotData.area)}</span>\`;
        if (chatbotData.pain) summary += \`<span class="chatbot-summary-field"><i class="fa-solid fa-face-grimace"></i> \${escapeHtml(chatbotData.pain)}</span>\`;
        if (chatbotData.urgency) summary += \`<span class="chatbot-summary-field"><i class="fa-solid fa-bolt"></i> \${escapeHtml(chatbotData.urgency)}</span>\`;
        if (hasRedFlag) summary += \`<span class="chatbot-summary-field chatbot-summary-field--alert"><i class="fa-solid fa-triangle-exclamation"></i> \${escapeHtml(chatbotData.redFlags)}</span>\`;
        summary += \`<span class="chatbot-summary-field"><i class="fa-solid fa-user-doctor"></i> \${escapeHtml(chatbotData._physioName || 'Asignacion automatica')}</span>\`;
        summary += \`<span class="chatbot-summary-field"><i class="fa-solid fa-clock"></i> \${escapeHtml(chatbotData.availability)}</span>\`;
        summary += \`<span class="chatbot-summary-field chatbot-summary-field--priority"><i class="fa-solid fa-flag"></i> Prioridad: \${escapeHtml(priority)}</span>\`;

        addBotMessage(summary);
        await delay(500);
        addBotMessage('¿Todo correcto? Envio la admision al equipo.');
        showChoices([
          { label: 'Enviar admision', value: 'send', icon: 'fa-paper-plane' },
          { label: 'Empezar de nuevo', value: 'restart', icon: 'fa-rotate' }
        ], async (val) => {
          if (val === 'restart') {
            resetChatbot();
          } else {
            await submitIntake();
          }
        });
        break;
      }

      case 'confirm_contact': {
        let summary = \`<strong>Resumen del contacto:</strong><br>\`;
        summary += \`<span class="chatbot-summary-field"><i class="fa-solid fa-user"></i> \${escapeHtml(chatbotData.name)}</span>\`;
        summary += \`<span class="chatbot-summary-field"><i class="fa-solid fa-envelope"></i> \${escapeHtml(chatbotData.email)}</span>\`;
        summary += \`<span class="chatbot-summary-field"><i class="fa-solid fa-phone"></i> \${escapeHtml(chatbotData.phone)}</span>\`;
        summary += \`<span class="chatbot-summary-field"><i class="fa-solid fa-comment-medical"></i> \${escapeHtml(chatbotData.reason)}</span>\`;
        summary += \`<span class="chatbot-summary-field"><i class="fa-solid fa-user-doctor"></i> \${escapeHtml(chatbotData._physioName || 'Asignacion automatica')}</span>\`;

        addBotMessage(summary);
        await delay(500);
        addBotMessage('Enviare tu solicitud para que la clinica se ponga en contacto contigo.');
        showChoices([
          { label: 'Enviar solicitud', value: 'send', icon: 'fa-paper-plane' },
          { label: 'Empezar de nuevo', value: 'restart', icon: 'fa-rotate' }
        ], async (val) => {
          if (val === 'restart') {
            resetChatbot();
          } else {
            await submitIntake();
          }
        });
        break;
      }
    }
  };

  const submitIntake = async () => {
    clearInput();
    const typing = showTyping();

    const payload = {
      name: chatbotData.name,
      email: chatbotData.email,
      phone: chatbotData.phone,
      reason: chatbotData.reason,
      source: 'typebot'
    };

    if (chatbotFlow === 'full') {
      payload.area = chatbotData.area || '';
      payload.pain = chatbotData.pain || '';
      payload.urgency = chatbotData.urgency || '';
      payload.redFlags = chatbotData.redFlags || '';
      payload.availability = chatbotData.availability || '';
      payload.privacyConsent = chatbotData.privacyConsent || '';
      payload.contactPreference = 'Email';
    } else {
      payload.urgency = 'Puede esperar unos dias';
      payload.privacyConsent = chatbotData.privacyConsent || 'Prefiere contacto clinica';
      payload.contactPreference = 'Telefono';
    }

    if (chatbotData.physiotherapistId) {
      payload.physiotherapistId = chatbotData.physiotherapistId;
    }
    if (chatbotData.physiotherapistEmail) {
      payload.physiotherapistEmail = chatbotData.physiotherapistEmail;
    }

    try {
      // Intenta obtener token de session si esta en dashboard, pero si no hay, manda sin auth.
      let token = null;
      if (typeof session !== 'undefined' && session.getToken) {
        token = session.getToken();
      }

      const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      };
      if (token) {
        headers.Authorization = \`Bearer \${token}\`;
      }

      const res = await fetch(\`\${API_BASE}/typebot/intake\`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      removeTyping();

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || 'Error al enviar la admision.');
      }

      const data = await res.json();
      chatbotFlow = 'done';

      if (data.appointmentCreated) {
        addBotMessage(\`<strong>¡Admision completada!</strong><br>Se ha creado una <strong>cita pendiente</strong> para \${escapeHtml(chatbotData.name)}. El equipo la revisara y te confirmara la hora exacta.\`, 'chatbot-msg--success');
      } else if (data.appointment) {
        addBotMessage(\`<strong>¡Admision completada!</strong><br>Ya tenias una cita activa. Los datos de admision se han guardado correctamente.\`, 'chatbot-msg--success');
      } else {
        addBotMessage(\`<strong>Solicitud enviada.</strong><br>La clinica se pondra en contacto contigo lo antes posible.\`, 'chatbot-msg--success');
      }

      // Refresh dashboard if we are in dashboard
      if (typeof loadAppointments === 'function') {
        loadAppointments();
      }

    } catch (error) {
      removeTyping();
      addBotMessage(\`<strong>Error:</strong> \${escapeHtml(error.message)}\`, 'chatbot-msg--error');
      showChoices([
        { label: 'Reintentar', value: 'retry', icon: 'fa-rotate' }
      ], async () => {
        await submitIntake();
      });
    }
  };

  const resetChatbot = () => {
    messagesContainer.innerHTML = '';
    chatbotData = {};
    chatbotFlow = 'idle';
    currentStepIndex = 0;
    startChatbot();
  };

  const startChatbot = async () => {
    chatbotFlow = 'starting';
    const typing = showTyping();
    await delay(600);
    removeTyping();
    await runStep('consent');
  };

};

document.addEventListener('DOMContentLoaded', buildNativeChatbot);
})();