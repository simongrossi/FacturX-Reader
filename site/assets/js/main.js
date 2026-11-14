/* Factur-X Reader — interactions du site. Aucune dépendance externe. */
(function () {
  "use strict";

  var root = document.documentElement;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* --- Thème clair / sombre --------------------------------------------- */
  var STORAGE_KEY = "fxr-theme";

  function systemTheme() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", theme === "dark" ? "#080d14" : "#ffffff");
    }
    var toggle = document.querySelector("[data-theme-toggle]");
    if (toggle) {
      var label = theme === "dark" ? "Passer au thème clair" : "Passer au thème sombre";
      toggle.setAttribute("aria-label", label);
      toggle.setAttribute("title", label);
    }
  }

  // Le thème est posé dès le <head> pour éviter un flash ; on synchronise l'état ici.
  applyTheme(root.getAttribute("data-theme") || systemTheme());

  document.addEventListener("click", function (event) {
    var toggle = event.target.closest("[data-theme-toggle]");
    if (!toggle) return;
    var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (error) {
      /* stockage indisponible : le thème reste valable pour la page */
    }
  });

  // Suit le système tant que l'utilisateur n'a pas choisi explicitement.
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  var onSystemChange = function () {
    var saved = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      saved = null;
    }
    if (!saved) applyTheme(systemTheme());
  };
  if (media.addEventListener) media.addEventListener("change", onSystemChange);
  else if (media.addListener) media.addListener(onSystemChange);

  /* --- Menu mobile ------------------------------------------------------- */
  var navToggle = document.querySelector("[data-nav-toggle]");
  var nav = document.getElementById("primary-nav");

  function setNav(open) {
    if (!nav || !navToggle) return;
    nav.classList.toggle("is-open", open);
    navToggle.setAttribute("aria-expanded", String(open));
  }

  if (navToggle && nav) {
    navToggle.addEventListener("click", function () {
      setNav(!nav.classList.contains("is-open"));
    });

    nav.addEventListener("click", function (event) {
      if (event.target.closest("a")) setNav(false);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") setNav(false);
    });

    document.addEventListener("click", function (event) {
      if (!nav.classList.contains("is-open")) return;
      if (nav.contains(event.target) || navToggle.contains(event.target)) return;
      setNav(false);
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth > 900) setNav(false);
    });
  }

  /* --- En-tête collant : bordure à partir du défilement ------------------ */
  var header = document.querySelector("[data-header]");
  if (header) {
    var onScroll = function () {
      header.classList.toggle("is-stuck", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* --- Apparition progressive des blocs ---------------------------------- */
  var targets = document.querySelectorAll(".reveal");
  if (targets.length) {
    if (reduceMotion || !("IntersectionObserver" in window)) {
      targets.forEach(function (el) {
        el.classList.add("is-in");
      });
    } else {
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("is-in");
            observer.unobserve(entry.target);
          });
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
      );
      targets.forEach(function (el) {
        observer.observe(el);
      });
    }
  }

  /* --- Année courante dans le pied de page ------------------------------- */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  /* --- Détection du système dans #telechargements ------------------------ */
  var osCards = document.querySelectorAll(".feature[data-os]");
  if (osCards.length) {
    var ua = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || "";
    var detected = /win/i.test(ua) ? "windows" : /mac/i.test(ua) ? "macos" : /linux|x11/i.test(ua) && !/android/i.test(ua) ? "linux" : null;
    if (detected) {
      osCards.forEach(function (card) {
        if (card.getAttribute("data-os") === detected) {
          card.classList.add("is-recommended");
          var badge = card.querySelector(".os-badge");
          if (badge) badge.hidden = false;
        }
      });
    }
  }

  /* --- Zoom / Lightbox sur les captures ---------------------------------- */
  var zoomImgs = document.querySelectorAll(".shot-frame img, .gallery__frame img");
  if (zoomImgs.length) {
    var box = null;
    var boxImg = null;
    var boxCap = null;
    var lastFocus = null;

    var closeBox = function () {
      if (!box || box.hidden) return;
      box.hidden = true;
      document.body.style.overflow = "";
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    };

    var openBox = function (img) {
      if (!box) {
        box = document.createElement("div");
        box.className = "lightbox";
        box.setAttribute("role", "dialog");
        box.setAttribute("aria-modal", "true");
        box.setAttribute("aria-label", "Capture agrandie");
        box.hidden = true;

        var closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "lightbox__close";
        closeBtn.setAttribute("aria-label", "Fermer");
        closeBtn.textContent = "\u00d7";
        closeBtn.addEventListener("click", closeBox);

        boxImg = document.createElement("img");
        boxImg.className = "lightbox__img";

        boxCap = document.createElement("p");
        boxCap.className = "lightbox__caption";

        box.appendChild(closeBtn);
        box.appendChild(boxImg);
        box.appendChild(boxCap);
        box.addEventListener("click", function (e) {
          if (e.target === box) closeBox();
        });
        document.addEventListener("keydown", function (e) {
          if (e.key === "Escape") closeBox();
        });
        document.body.appendChild(box);
      }

      lastFocus = document.activeElement;
      boxImg.src = img.currentSrc || img.src;
      boxImg.alt = img.alt || "";
      boxCap.textContent = img.alt || "";
      box.hidden = false;
      document.body.style.overflow = "hidden";
      box.querySelector(".lightbox__close").focus();
    };

    zoomImgs.forEach(function (img) {
      img.setAttribute("tabindex", "0");
      img.setAttribute("role", "button");
      img.setAttribute("aria-label", (img.alt ? img.alt + " — " : "") + "Agrandir la capture");
      img.addEventListener("click", function () {
        openBox(img);
      });
      img.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openBox(img);
        }
      });
    });
  }
})();
