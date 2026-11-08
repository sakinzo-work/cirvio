/* CIRVIO SEO helpers for canonical listing metadata and matching JSON-LD. */
(() => {
    'use strict';
    const siteName = 'CIRVIO';
    const productionOrigin = 'https://cirvio.netlify.app';
    const origin = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
        ? location.origin
        : productionOrigin;

    function text(value, fallback = '') {
        return String(value ?? fallback).replace(/\s+/g, ' ').trim();
    }

    function absoluteUrl(value) {
        try { return new URL(value, origin).href; } catch { return ''; }
    }

    function setMeta(selector, attribute, value) {
        const element = document.querySelector(selector);
        if (element && value) element.setAttribute(attribute, value);
    }

    function setJsonLd(id, data) {
        let script = document.getElementById(id);
        if (!script) {
            script = document.createElement('script');
            script.id = id;
            script.type = 'application/ld+json';
            document.head.appendChild(script);
        }
        script.textContent = JSON.stringify(data);
    }

    function listingUrl(id) {
        const url = new URL('product.html', origin + '/');
        url.searchParams.set('id', text(id));
        return url.href;
    }

    function setupWebsiteSchema() {
        if (!/(^|\/)index\.html$/.test(location.pathname) && location.pathname !== '/') return;
        setJsonLd('cirvio-website-schema', {
            '@context': 'https://schema.org',
            '@graph': [
                {
                    '@type': 'WebSite',
                    '@id': origin + '/#website',
                    url: origin + '/',
                    name: siteName,
                    description: 'Student marketplace for used books, notes and study materials.',
                    potentialAction: {
                        '@type': 'SearchAction',
                        target: origin + '/explore.html?q={search_term_string}',
                        'query-input': 'required name=search_term_string'
                    }
                },
                {
                    '@type': 'Organization',
                    '@id': origin + '/#organization',
                    name: siteName,
                    url: origin + '/',
                    logo: origin + '/cirvio-app-icon.png'
                }
            ]
        });
    }

    function setProduct(product) {
        if (!product || !text(product.id || product._id)) return;
        const title = text(product.title, 'Study material');
        const category = text(product.cat || product.category, 'Study material');
        const description = text(product.desc || product.description, `Approved ${category.toLowerCase()} listing on CIRVIO.`).slice(0, 155);
        const canonical = listingUrl(product.id || product._id);
        const imageUrls = (Array.isArray(product.images) ? product.images : [product.img])
            .map(value => text(value))
            .filter(value => /^https?:\/\//i.test(value));
        const price = Number(product.price);
        const listingType = text(product.type, 'sell');

        document.title = `${title} | ${siteName}`;
        setMeta('meta[name="description"]', 'content', description);
        setMeta('meta[property="og:title"]', 'content', `${title} | ${siteName}`);
        setMeta('meta[property="og:description"]', 'content', description);
        setMeta('meta[property="og:url"]', 'content', canonical);
        setMeta('meta[name="twitter:title"]', 'content', `${title} | ${siteName}`);
        setMeta('meta[name="twitter:description"]', 'content', description);
        const canonicalLink = document.querySelector('link[rel="canonical"]');
        if (canonicalLink) canonicalLink.href = canonical;
        if (imageUrls[0]) {
            setMeta('meta[property="og:image"]', 'content', imageUrls[0]);
            setMeta('meta[name="twitter:image"]', 'content', imageUrls[0]);
        }

        const schema = {
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: title,
            description,
            url: canonical,
            category,
            itemCondition: 'https://schema.org/UsedCondition'
        };
        if (imageUrls.length) schema.image = imageUrls;
        if (listingType === 'sell' && Number.isFinite(price) && price > 0) {
            schema.offers = {
                '@type': 'Offer',
                url: canonical,
                priceCurrency: 'INR',
                price: String(price),
                availability: 'https://schema.org/InStock',
                itemCondition: 'https://schema.org/UsedCondition'
            };
        }
        setJsonLd('cirvio-product-schema', schema);
    }

    window.CirvioSEO = { setProduct, setupWebsiteSchema };
    setupWebsiteSchema();
})();
