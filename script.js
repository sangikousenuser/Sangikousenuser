const root = document.documentElement;
const hero = document.querySelector(".hero");
const revealTargets = document.querySelectorAll("[data-reveal]");

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function updateScrollState() {
  const maxScroll = document.body.scrollHeight - window.innerHeight;
  const pageProgress = maxScroll > 0 ? window.scrollY / maxScroll : 0;
  root.style.setProperty("--scroll", clamp(pageProgress).toFixed(4));

  if (hero) {
    const rect = hero.getBoundingClientRect();
    const heroProgress = clamp((window.innerHeight - rect.top) / (window.innerHeight + rect.height));
    root.style.setProperty("--hero-progress", heroProgress.toFixed(4));
  }
}

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
      }
    });
  },
  { threshold: 0.16 },
);

revealTargets.forEach((target) => observer.observe(target));
window.addEventListener("scroll", updateScrollState, { passive: true });
window.addEventListener("resize", updateScrollState);
updateScrollState();
