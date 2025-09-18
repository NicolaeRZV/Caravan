# Firma Protectie Geamuri - Static Site

A simple, multi-page static website you can host with GitHub Pages.

## Structure
- `index.html` – Home
- `about.html` – About us
- `products.html` – Products overview
- `product.html` – Product detail (uses `?sku=`: `covers`, `films`, `custom`, `install`)
- `gallery.html` – Gallery with before/after module
- `blog.html` – Blog list
- `contact.html` – Contact form (client-side stub)
- `404.html` – Not found page
- `assets/` – CSS, JS, images
- `.nojekyll` – Disables Jekyll processing on GitHub Pages

## Host on GitHub Pages
1. Create a new GitHub repository and push this folder's contents to the repo root (not in a subfolder).
2. In GitHub → Settings → Pages:
   - Source: Deploy from a branch
   - Branch: `main` (or `master`) / root (`/`)
3. Save. After a minute, your site will be available at the Pages URL.

If your site is served from a project subpath like `https://username.github.io/repo`, all links here are relative and will work as-is.

## Local preview
Just open `index.html` in your browser. No build step required. 