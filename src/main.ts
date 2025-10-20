import puppeteer, { Browser } from "puppeteer";
import { execSync } from "child_process";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

interface noticia {
  titulo: string;
  resumo: string;
  conteudo: string;
  data_publicacao: number;
  local_id?: number;
  tags?: string[];
  imagens?: string[];
}

const buscarCampos = async (browser: Browser, id: number) => {
  const page = await browser.newPage();
  try {
    await page.goto(`https://fcv.org.br/site/noticia/detalhe/${id}`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });

    await page.waitForSelector(".titulo_det", { timeout: 1500 });
    await page.waitForSelector(".date-cad", { timeout: 1500 });
    await page.waitForSelector(".detalhe_texto", { timeout: 1500 });

    const title = await page.$eval(
      ".titulo_det",
      (el) => el.textContent?.trim() || null,
    );

    const date = await page.$eval(
      ".date-cad",
      (el) => el.textContent?.trim() || null,
    );

    const body = await page.$eval(
      ".detalhe_texto",
      (el) => el.textContent?.trim() || null,
    );

    const images_links = await page.$$eval(
      "img.ug-thumb-image",
      (imgs) =>
        imgs
          .map((img) => img.getAttribute("src"))
          .filter((src) => src !== null) as string[],
    );

    return { id, title, date, body, images_links };
  } catch (error: any) {
    return {
      id,
      title: null,
      date: null,
      body: null,
      images_links: null,
      error: error.message,
    };
  } finally {
    await page.close();
  }
};

const gerarResumo = async (conteudo: string) => {
  try {
    const prompt = `

      ${conteudo}

      Gere um resumo de no maximo 4 linhas sobre o texto acima, apenas me retore um json: {resumo: ....}
    `;

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPEN_ROUTER_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "meta-llama/llama-3.3-8b-instruct:free",
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
        }),
      },
    );

    return await response.json();
  } catch (err: any) {
    return { erro: err.message };
  }
};

const gerarTags = async (id: number, corpo_noticia: string) => {
  console.log("Gerando Tags");

  try {
    const prompt = `
      NoticiaID: ${id} :

      ${corpo_noticia}

      ----

      gere tags baseado nesse texto acima e me retorne em json string: {noticiaID: id, tags: ["etc..", "etc.."]}, não me retorne mais nada, alem do json.

      contexto:

      A Fundação Cristiano Varella é uma instituição sem fins lucrativos, localizada em Muriaé, Minas Gerais, que se dedica ao combate ao câncer. Fundada em 1995, a FCV mantém o Hospital do Câncer de Muriaé, um dos maiores e mais completos centros de tratamento oncológico do país.
  `;

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPEN_ROUTER_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "meta-llama/llama-3.3-8b-instruct:free",
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
        }),
      },
    );

    return await response.json();
  } catch (err: any) {
    return { erro: err.message };
  }
};

const transformarData = (dateTimeStr: string): number => {
  const regex = /(\d{2})\/(\d{2})\/(\d{4})\s+às\s+(\d{1,2})h(\d{2})/;
  const match = dateTimeStr.match(regex);

  if (!match) {
    throw new Error("Formato de data inválido");
  }

  const [, day, month, year, hour, minute] = match;

  if (!day || !month || !year || !hour || !minute) {
    throw new Error("Datas estão vazias");
  }

  const date = new Date(
    parseInt(year, 10),
    parseInt(month, 10) - 1,
    parseInt(day, 10),
    parseInt(hour, 10),
    parseInt(minute, 10),
  );

  return Math.floor(date.getTime() / 1000);
};

const simpleExample = async () => {
  const browser = await puppeteer.launch({ headless: true });

  const ids = [1301, 1302, 1303, 1304, 1305, 1306, 1307, 1308, 1309];

  try {
    const resultados = await Promise.all(
      ids.map((id) => buscarCampos(browser, id)),
    );

    let noticias_ok: noticia[] = new Array();

    resultados.forEach(
      async ({ id, title, date, body, images_links, error }) => {
        if (error) {
          console.log(`ID ${id}: ERRO - ${error}`);
        } else {
          if (!body || !date || !title) {
            return;
          }

          const retorno_tags = await gerarTags(id, body);
          const retorno_resumo = await gerarResumo(body);

          console.log(retorno_tags);
          console.log(retorno_resumo);

          const tags = JSON.parse(retorno_tags.choices[0].message.content);
          const resumo = JSON.parse(retorno_resumo.choices[0].message.content);

          if (!tags || !resumo) {
            console.log("Tags ou Resumo não existe");
            return;
          }

          if (tags.erro || resumo.erro) {
            console.log(tags.erro || resumo.erro);
            return;
          }

          const timeStap = transformarData(date.toString());

          if (!timeStap) {
            throw new Error("TimeStamp veio vazio");
          }

          const novaNoticia: noticia = {
            titulo: title,
            resumo: resumo.resumo,
            conteudo: body,
            data_publicacao: timeStap,
            tags: tags,
            imagens: images_links,
          };

          console.log(novaNoticia);
          noticias_ok.push(novaNoticia);
        }
      },
    );
  } finally {
    await browser.close();
  }
};

simpleExample();
