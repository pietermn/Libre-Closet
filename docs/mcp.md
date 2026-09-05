# Garments and photos through MCP

Connect an OAuth-capable MCP client to `https://YOUR_HOST/mcp` and authorize your account. Connections can be revoked at `/auth/mcp`. Tools operate on the linked account's wardrobe.

## Find garments

`list_garments` and `search_garments` accept the same optional filters:

| Argument            | Meaning                                                         |
| ------------------- | --------------------------------------------------------------- |
| `query`             | Case-insensitive text search in name, brand, notes and category |
| `category`, `brand` | Case-insensitive exact match                                    |
| `color`             | One color, including garments with a combination of colors      |
| `size`              | Size; common aliases such as `M` are normalized                 |
| `include_archived`  | Include archived garments; defaults to false                    |
| `limit`             | Page size, 1–100; defaults to 25                                |
| `offset`            | Number of results to skip; defaults to 0                        |

Filters combine with AND. Results are ordered by newest ID first. The response contains `garments`, `total`, `limit`, `offset`, and `nextOffset`. Pass `nextOffset` as the next request's `offset`; null means there are no more results.

Example tool arguments for `search_garments`:

```json
{ "category": "outerwear", "color": "blue", "size": "M", "limit": 10 }
```

`get_garment` retrieves one item with `{"id":42}`. Reading garments and photos requires `closet:read`.

## Add or replace a photo

Pass a public, direct image URL as `photoUrl` to `create_garment` or `update_garment`. The application downloads and stores the image using its configured local or S3 storage. The agent supplies the clothing details; no clothing recognition is invoked.

Example `create_garment` arguments:

```json
{
  "name": "Blue bomber jacket",
  "category": "outerwear",
  "brand": "Example",
  "color": "blue",
  "size": "M",
  "photoUrl": "https://images.example.com/jacket.jpg"
}
```

Creation requires `category`. Updating requires `id` and changes only the supplied fields. To replace only the photo:

```json
{ "id": 42, "photoUrl": "https://images.example.com/new-jacket.jpg" }
```

Both tools require `closet:write`. Downloads accept JPEG, PNG, WebP or GIF, up to 10 MiB and 40 million pixels. Images are converted to WebP; animated images use the first frame. Downloads time out after 20 seconds and follow at most three redirects. URLs must use public HTTP/HTTPS addresses, standard ports, and no embedded credentials. A failed download leaves an existing garment and photo unchanged.

## Display photos

Garment results include `photoUrl` and `photoPreviewUrl`, or null if no photo exists. These application URLs may require a browser login and should not be treated as public share links.

For an agent to receive the actual image, call `get_garment_photo` with `{"id":42}`. Its MCP result contains an `image` content block with `mimeType: "image/webp"` and base64 `data`, ready for an image-capable MCP client to display. It returns the background-removed variant if available, otherwise the original stored image. An item without a photo returns a tool error. Image bytes are fetched only on this explicit call, keeping search responses small.
