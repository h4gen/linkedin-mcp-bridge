# Capability-led Chrome Web Store promo graphics

Replacement creative direction, 2026-10-30. Supersedes the rejected `store/graphics` concept. This delivery contains two promotional graphics only, no screenshots.

- `upload/promo-marquee-1400x560.png`: benefit headline plus people research, reading/replying to messages, and drafting/scheduling posts.
- `upload/promo-small-440x280.png`: Find people. Reply faster. Plan posts.

Built with the built-in image_gen tool. Full prompts in `prompts.json`, original art in `source/`. English copy follows the current product language. Claims refer to available connector capabilities, not store approval or a direct ChatGPT website integration. No product runtime or UI changes.

The export script uses Node.js and `sharp` (resolve through NODE_PATH if needed), preserves all artwork and validates exact RGB PNG dimensions:

```sh
node store/graphics-v2/export.mjs
zip -j store/graphics-v2/linkedin-connector-promos-v2.zip store/graphics-v2/upload/*.png
```

Review at final upload size for typography and image boundaries. These exports are promotional images; they do not fulfill the separate store screenshot requirement. No store submission has been performed.
