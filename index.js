const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// ⚠ Aquí puedes limitar a tu dominio de Shopify si quieres más seguridad
// const allowedOrigin = "https://tienda-prueba-app-st.myshopify.com";
// app.use(cors({ origin: allowedOrigin }));
app.use(cors()); // De momento abierto para evitar líos de CORS

app.use(express.json());

const SHOP_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;   // ej: "tienda-prueba-app-st.myshopify.com"
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-07";
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;    // tu shpat_... en Render

async function callShopify(query, variables = {}) {
  if (!SHOP_DOMAIN || !ADMIN_TOKEN) {
    throw new Error("Faltan variables de entorno SHOPIFY_STORE_DOMAIN o SHOPIFY_ADMIN_TOKEN");
  }

  const response = await fetch(
    `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": ADMIN_TOKEN
      },
      body: JSON.stringify({ query, variables })
    }
  );

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = json?.errors?.[0]?.message || response.statusText;
    throw new Error("Shopify API error: " + message);
  }

  if (json.errors && json.errors.length) {
    throw new Error("Shopify GraphQL error: " + json.errors[0].message);
  }

  return json.data;
}

// ===================== ENDPOINT PRINCIPAL =====================
app.post("/create-order", async (req, res) => {
  try {
    const {
      customerNumericId,  // siempre obligatorio
      productNumericId,   // obligatorio si NO mandas variantNumericId
      variantNumericId,   // opcional, si el producto tiene variantes
      quantity
    } = req.body || {};

    if (!customerNumericId) {
      return res.status(400).json({ ok: false, error: "Falta customerNumericId" });
    }

    if (!productNumericId && !variantNumericId) {
      return res.status(400).json({
        ok: false,
        error: "Pon productNumericId o variantNumericId"
      });
    }

    const qty = Number(quantity || 1) || 1;
    const customerGID = `gid://shopify/Customer/${customerNumericId}`;

    let variantGID;

    // Si viene variantNumericId, lo usamos directamente
    if (variantNumericId) {
      variantGID = `gid://shopify/ProductVariant/${variantNumericId}`;
    } else {
      // Si solo has mandado productNumericId, buscamos la PRIMERA variante del producto
      const productGID = `gid://shopify/Product/${productNumericId}`;
      const data = await callShopify(
        `
        query GetDefaultVariant($id: ID!) {
          product(id: $id) {
            variants(first: 1) {
              edges {
                node { id }
              }
            }
          }
        }
        `,
        { id: productGID }
      );

      const edges = data.product?.variants?.edges || [];
      if (!edges.length) {
        return res.status(400).json({
          ok: false,
          error: "El producto no tiene variantes disponibles"
        });
      }

      variantGID = edges[0].node.id;
    }

    // ===================== MUTACIÓN CORREGIDA =====================
    const orderData = await callShopify(
      `
      mutation CreateOrder($order: OrderCreateOrderInput!) {
        orderCreate(order: $order) {
          order {
            id
            name
            statusUrl
          }
          userErrors {
            field
            message
          }
        }
      }
      `,
      {
        order: {
          customerId: customerGID,
          lineItems: [
            {
              variantId: variantGID,
              quantity: qty
            }
          ],
          tags: ["pedido_por_admin"],
          note: "Pedido creado desde backend Render"
        }
      }
    );
    // ===============================================================

    const userErrors = orderData.orderCreate.userErrors || [];
    if (userErrors.length) {
      return res.status(400).json({
        ok: false,
        error: userErrors.map(e => e.message).join(", ")
      });
    }

    return res.json({
      ok: true,
      order: orderData.orderCreate.order
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Error interno"
    });
  }
});

// Ruta básica para comprobar que el backend vive
app.get("/", (_req, res) => {
  res.send("Shopify B2B backend OK");
});

app.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});


