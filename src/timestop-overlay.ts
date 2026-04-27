requestAnimationFrame(() => {
  setTimeout(() => {
    document.getElementById("top")?.classList.add("show");
    document.getElementById("bottom")?.classList.add("show");
  }, 50);
});
