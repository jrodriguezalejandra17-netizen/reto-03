# Imagen lista para Render / Railway / Fly / Cloud Run / cualquier host de contenedores.
# Node 24 ejecuta TypeScript directamente (type stripping), así que no hay paso de build.
FROM node:24-alpine

WORKDIR /app

# node:alpine no trae git ni herramientas de compilación; zod y el runtime no las necesitan.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Código, conocimiento y recursos en tiempo de ejecución.
COPY src ./src
COPY agent ./agent
COPY web ./web
COPY fixtures ./fixtures
COPY demo.ts ./demo.ts

ENV NODE_ENV=production
# El host debe inyectar PORT; 3000 es el valor local por defecto.
ENV PORT=3000
EXPOSE 3000

# Las credenciales del modelo llegan por variables de entorno en el host (LLM_API_KEY,
# LLM_BASE_URL, LLM_MODEL). Nunca se copian a la imagen ni al repositorio.
# Nota: el sistema de archivos del contenedor es efímero; out/ (evidencia, control.csv,
# órdenes del SAP simulado) se recrea en cada arranque. Para persistirlo, montar un volumen
# en /app/out.
CMD ["npm", "start"]
