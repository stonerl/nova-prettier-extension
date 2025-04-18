---
title: "{{ page.title | default: 'Markdown + Liquid Test' }}"
layout: default
lang: "{{ page.lang | default: 'en' }}"
---

{% comment %}
Assign some values for testing
{% endcomment %}
{% assign user_name = customer.first_name | default: 'Guest' %}

# {{ page.title }}

Hello, **{{ user_name }}**!
Welcome to your Liquid‑powered Markdown test page.

{% capture intro -%}
This section uses a `capture` block to store multi‑line content for later reuse.
{%- endcapture %}

> {{ intro }}

## User Status

{% if customer %}

- ✅ Logged in as **{{ customer.email }}**
- Member since {{ customer.created_at | date: "%B %d, %Y" }}
  {% else %}
- 🚪 You’re browsing as a guest.
- Please [log in](/account/login) or [create an account](/account/register).
  {% endif %}

## Products Table

| Product | Price | Available? |
| ------- | ----- | ---------- |

{% for product in collections.frontpage.products %}
| [{{ product.title }}]({{ product.url }}) | {{ product.price | money }} | {% if product.available %}Yes{% else %}No{% endif %} |
{% endfor %}

## Featured Image

{% assign featured = collections.frontpage.products.first %}
![{{ featured.title }}]({{ featured.featured_image | img_url: 'large' }})
_Image for {{ featured.title }} | Price: {{ featured.price | money_without_currency }}_

## Blog Roll (Paginated)

{% paginate blog.articles by 3 %}

1. {% for article in paginate.items -%}
   - **[{{ article.title }}]({{ article.url }})**
     _{{ article.published_at | date: "%Y-%m-%d" }}_
     {{ article.excerpt | strip_html | truncate: 100 }}
     {%- unless forloop.last %}
     {%- endunless %}
     {%- endfor %}

{% if paginate.next %}
➡️ [Next page →]({{ paginate.next.url }})
{% endif %}
{% endpaginate %}

## Raw Liquid Example

{% raw %}

```liquid
{% if false %}
  This will never render.
{% endif %}
```
