(function(){

  /* ---------- Mobile menu (all pages) ---------- */
  var menuBtn = document.getElementById('menuBtn');
  var mobileMenu = document.getElementById('mobileMenu');
  if(menuBtn && mobileMenu){
    menuBtn.addEventListener('click', function(){ mobileMenu.classList.toggle('open'); });
    mobileMenu.querySelectorAll('a').forEach(function(a){
      a.addEventListener('click', function(){ mobileMenu.classList.remove('open'); });
    });
  }

  /* ---------- Hero reveal slider (home page only) ---------- */
  var reveal = document.getElementById('reveal');
  if(reveal){
    var clip = document.getElementById('revealClip');
    var handle = document.getElementById('revealHandle');
    var dragging = false;

    function setPos(pct){
      pct = Math.min(96, Math.max(4, pct));
      clip.style.clipPath = 'inset(0 ' + (100 - pct) + '% 0 0)';
      handle.style.left = pct + '%';
    }
    function fromClientX(clientX){
      var rect = reveal.getBoundingClientRect();
      var pct = ((clientX - rect.left) / rect.width) * 100;
      setPos(pct);
    }
    setPos(50);

    reveal.addEventListener('pointerdown', function(e){
      dragging = true;
      reveal.setPointerCapture(e.pointerId);
      fromClientX(e.clientX);
    });
    reveal.addEventListener('pointermove', function(e){
      if(!dragging) return;
      fromClientX(e.clientX);
    });
    reveal.addEventListener('pointerup', function(){ dragging = false; });
    reveal.addEventListener('pointercancel', function(){ dragging = false; });
  }

  /* ---------- Workflow stepper (process page only) ---------- */
  var stepBtns = document.querySelectorAll('.step-btn');
  var wfIcon = document.getElementById('wfIcon');
  var wfTitle = document.getElementById('wfTitle');
  var wfDesc = document.getElementById('wfDesc');
  if(stepBtns.length && wfIcon && wfTitle && wfDesc){
    var wfData = [
      { title: "Ingestion &amp; Brand DNA", desc: "We extract your brand rules, color palettes, product geometry, and typography hierarchies into a permanent memory layer.", icon: "\ud83d\udce5" },
      { title: "AI Model Conditioning", desc: "Your assets condition custom multimodal models to lock in visual fidelity and eliminate style drift across high volumes.", icon: "\u2699\ufe0f" },
      { title: "Human-in-the-Loop Polish", desc: "Senior creative directors inspect every single output, refining lighting, pacing, typography, and marketing claims.", icon: "\ud83d\udc41\ufe0f" },
      { title: "Multi-Channel Deployment", desc: "Deliverables are exported in platform-native aspect ratios (9:16, 1:1, 16:9), fully ready for immediate ad spend.", icon: "\ud83d\ude80" }
    ];
    stepBtns.forEach(function(btn){
      btn.addEventListener('click', function(){
        stepBtns.forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        var i = parseInt(btn.getAttribute('data-step'), 10);
        wfIcon.textContent = wfData[i].icon;
        wfTitle.innerHTML = wfData[i].title;
        wfDesc.textContent = wfData[i].desc;
      });
    });
  }

  /* ---------- Pricing cycle toggle (pricing page only) ---------- */
  var cycleBtns = document.querySelectorAll('.cycle-btn');
  var priceNums = document.querySelectorAll('.price-amount .num[data-base]');
  if(cycleBtns.length){
    cycleBtns.forEach(function(btn){
      btn.addEventListener('click', function(){
        cycleBtns.forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        var cycle = btn.getAttribute('data-cycle');
        priceNums.forEach(function(el){
          var base = parseInt(el.getAttribute('data-base'), 10);
          var val = cycle === 'quarterly' ? Math.round(base * 0.9) : base;
          el.textContent = '\u20b9' + val.toLocaleString('en-IN');
        });
      });
    });
  }

  /* ---------- Intake multi-step form (contact page only) ---------- */
  var intakeForm = document.getElementById('intakeForm');
  if(intakeForm){
    var formData = { brand:'', category:'', assets:[], timeline:'', platform:'', email:'', whatsapp:'' };
    var currentStep = 0;
    var totalSteps = 4;

    var formSteps = document.querySelectorAll('.form-step');
    var dots = document.querySelectorAll('.dot');
    var lbls = document.querySelectorAll('.lbl');
    var lines = document.querySelectorAll('.line');
    var backBtn = document.getElementById('backBtn');
    var nextBtn = document.getElementById('nextBtn');
    var fBrand = document.getElementById('fBrand');
    var fEmail = document.getElementById('fEmail');
    var fWhatsapp = document.getElementById('fWhatsapp');

    function selectChip(container, single){
      if(!container) return;
      container.addEventListener('click', function(e){
        var btn = e.target.closest('.chip, .pill');
        if(!btn) return;
        if(single){
          container.querySelectorAll('.chip, .pill').forEach(function(c){ c.classList.remove('selected'); });
          btn.classList.add('selected');
        } else {
          btn.classList.toggle('selected');
        }
        updateFormData();
        validateStep();
      });
    }
    selectChip(document.getElementById('categoryChips'), true);
    selectChip(document.getElementById('assetChips'), false);
    selectChip(document.getElementById('timelinePills'), true);
    selectChip(document.getElementById('platformPills'), true);

    if(fBrand) fBrand.addEventListener('input', function(){ updateFormData(); validateStep(); });
    if(fEmail) fEmail.addEventListener('input', function(){ updateFormData(); validateStep(); });
    if(fWhatsapp) fWhatsapp.addEventListener('input', updateFormData);

    function updateFormData(){
      formData.brand = fBrand.value;
      formData.email = fEmail.value;
      formData.whatsapp = fWhatsapp.value;
      var catSel = document.querySelector('#categoryChips .selected');
      formData.category = catSel ? catSel.getAttribute('data-val') : '';
      formData.assets = Array.from(document.querySelectorAll('#assetChips .selected')).map(function(c){ return c.getAttribute('data-val'); });
      var timeSel = document.querySelector('#timelinePills .selected');
      formData.timeline = timeSel ? timeSel.getAttribute('data-val') : '';
      var platSel = document.querySelector('#platformPills .selected');
      formData.platform = platSel ? platSel.getAttribute('data-val') : '';
    }

    function canProceed(step){
      if(step === 0) return formData.brand.trim() !== '' && formData.category !== '';
      if(step === 1) return formData.assets.length > 0;
      if(step === 2) return formData.timeline !== '' && formData.platform !== '';
      if(step === 3) return formData.email.trim().includes('@');
      return false;
    }

    function validateStep(){
      nextBtn.disabled = !canProceed(currentStep);
    }

    function renderStep(){
      formSteps.forEach(function(s){
        s.classList.toggle('active', parseInt(s.getAttribute('data-step'),10) === currentStep);
      });
      dots.forEach(function(d){
        var i = parseInt(d.getAttribute('data-dot'), 10);
        d.classList.toggle('active', i === currentStep);
        d.classList.toggle('done', i < currentStep);
        d.textContent = i < currentStep ? '\u2713' : (i + 1);
      });
      lbls.forEach(function(l){
        var i = parseInt(l.getAttribute('data-lbl'), 10);
        l.classList.toggle('active', i <= currentStep);
      });
      lines.forEach(function(l){
        var i = parseInt(l.getAttribute('data-line'), 10);
        l.classList.toggle('done', i < currentStep);
      });
      backBtn.disabled = currentStep === 0;
      nextBtn.textContent = currentStep === totalSteps - 1 ? 'Submit Brief \u2192' : 'Continue \u2192';
      validateStep();
    }

    backBtn.addEventListener('click', function(){
      if(currentStep > 0){ currentStep--; renderStep(); }
    });

    intakeForm.addEventListener('submit', function(e){
      e.preventDefault();
      if(!canProceed(currentStep)) return;
      if(currentStep < totalSteps - 1){
        currentStep++;
        renderStep();
      } else {
        var errEl = document.getElementById('intakeError');
        if (errEl) errEl.style.display = 'none';
        nextBtn.disabled = true;
        nextBtn.textContent = 'Submitting...';

        fetch('/api/discovery-call-submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        }).then(function(res){
          return res.json().then(function(data){ return { ok: res.ok, data: data }; });
        }).then(function(result){
          if (!result.ok) {
            throw new Error((result.data && result.data.error) || 'Submission failed');
          }
          document.getElementById('intakeForm').style.display = 'none';
          document.getElementById('successBrand').textContent = formData.brand;
          document.getElementById('successEmail').textContent = formData.email;
          document.getElementById('successBox').style.display = 'block';
        }).catch(function(err){
          nextBtn.disabled = false;
          nextBtn.textContent = 'Submit Brief →';
          if (errEl) {
            errEl.textContent = 'Something went wrong sending your brief — please try again, or reach us directly via WhatsApp/email below. (' + err.message + ')';
            errEl.style.display = 'block';
          }
        });
      }
    });

    renderStep();
  }

})();
