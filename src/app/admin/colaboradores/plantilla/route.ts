import ExcelJS from "exceljs";
import { isAdminAuthenticated } from "@/lib/auth/admin";

/**
 * Plantilla de ejemplo para la importación de colaboradores.
 * Columnas que el importador detecta: correo, rut, nombre, cupo.
 */
export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return new Response("No autorizado", { status: 401 });
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Colaboradores");

  sheet.columns = [
    { header: "correo", key: "correo", width: 32 },
    { header: "rut", key: "rut", width: 16 },
    { header: "nombre", key: "nombre", width: 28 },
    { header: "cupo", key: "cupo", width: 10 },
  ];

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF22312A" } };

  sheet.addRows([
    { correo: "maria.gonzalez@empresa.cl", rut: "12.345.678-5", nombre: "María González", cupo: 2 },
    { correo: "pedro.soto@empresa.cl", rut: "9.876.543-3", nombre: "Pedro Soto", cupo: 1 },
    { correo: "carla.munoz@empresa.cl", rut: "", nombre: "Carla Muñoz", cupo: 3 },
  ]);

  // Hoja de instrucciones
  const help = workbook.addWorksheet("Instrucciones");
  help.getColumn(1).width = 90;
  const lines = [
    "Cómo completar esta plantilla",
    "",
    "• correo: correo del colaborador (ahí recibirá su código de acceso). Recomendado.",
    "• rut: opcional si hay correo. Con o sin puntos, con guión (ej: 12.345.678-5).",
    "• nombre: nombre y apellido del colaborador.",
    "• cupo: cuántos regalos puede elegir. Si se deja vacío, se usa el cupo por defecto de la campaña.",
    "",
    "Puedes borrar las filas de ejemplo. Re-importar la misma lista actualiza nombres y cupos (no duplica).",
    "También se acepta un archivo .csv con las mismas columnas.",
  ];
  lines.forEach((text, i) => {
    const cell = help.getCell(i + 1, 1);
    cell.value = text;
    if (i === 0) cell.font = { bold: true, size: 13 };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-colaboradores-caramba.xlsx"',
    },
  });
}
