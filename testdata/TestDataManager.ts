import * as fs   from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { configManager } from '../src/config/env.index';

type ExcelFormulaResult = string | number | boolean | null;

interface JsonDataProfile<T> {
    testDataName: string;
    data: T[];
}

interface LoginData {
    Username: string;
    Password: string;
}

interface JsonProfileDataMap {
    Orange_Login_Data: LoginData;
    Purchase_Order_Data: LoginData;
}

export class TestDataManager {

    private static instances: Set<TestDataManager> = new Set();
    private dataPath: string;
    private cache: Map<string, any> = new Map();

    constructor() {
        this.dataPath = path.join(process.cwd(), 'testdata');
        TestDataManager.instances.add(this);
    }

    static clearCache(): void {
        for (const instance of TestDataManager.instances) {
            instance.clearCache();
        }
    }

    // =========================================================================
    // PRIVATE HELPER — resolve sheet by name OR index, default = first sheet
    // =========================================================================

    private async resolveSheet(
        workbook:  ExcelJS.Workbook,
        sheet?:    string | number       // name, index, or undefined = first sheet
    ): Promise<ExcelJS.Worksheet> {

        // ── No sheet argument → use first sheet ───────────────────────────────
        if (sheet === undefined || sheet === null) {
            const first = workbook.worksheets[0];
            if (!first) throw new Error(`Workbook has no sheets`);
            return first;
        }

        // ── Number → treat as 0-based index ──────────────────────────────────
        if (typeof sheet === 'number') {
            const ws = workbook.worksheets[sheet];
            if (!ws) throw new Error(
                `Sheet index ${sheet} not found. Available: 0–${workbook.worksheets.length - 1}`
            );
            return ws;
        }

        // ── String → treat as sheet name ──────────────────────────────────────
        const ws = workbook.getWorksheet(sheet);
        if (!ws) throw new Error(
            `Sheet "${sheet}" not found. Available: ${workbook.worksheets.map(s => s.name).join(', ')}`
        );
        return ws;
    }

    // =========================================================================
    // JSON
    // =========================================================================

    private getConfiguredJsonFilePath(fileName: string): string {
        if (!fileName || !fileName.trim()) {
            throw new Error('JSON file name is required');
        }

        if (path.isAbsolute(fileName) || fileName.includes('..')) {
            throw new Error(
                `Invalid JSON file name: "${fileName}". ` +
                'Pass only a file name such as "login.json".'
            );
        }

        return path.join(
            process.cwd(),
            configManager.getTestDataPath(),
            fileName
        );
    }

    loadJson<T = Record<string, any>>(fileName: string): T {
        const fullPath = this.getConfiguredJsonFilePath(fileName);
        const cacheKey = `json_config_${fullPath}`;

        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey) as T;
        }

        if (!fs.existsSync(fullPath)) {
            throw new Error(
                `JSON file not found: ${fullPath}\n` +
                `Configured test data path: ${configManager.getTestDataPath()}`
            );
        }

        try {
            const data = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as T;
            this.cache.set(cacheKey, data);
            return data;
        } catch (error: any) {
            throw new Error(
                `Failed to parse JSON file: ${fullPath}\n` +
                `Error: ${error.message}`
            );
        }
    }

    private isJsonFileName(value: string): boolean {
        return /\.json$/i.test(value.trim());
    }

    private getJsonProfileRow<T = Record<string, any>>(
        testDataName: string,
        fileName: string,
        rowIndex = 0
    ): T {
        const profiles = this.loadJson<JsonDataProfile<T>[]>(fileName);

        if (!Array.isArray(profiles)) {
            throw new Error(
                `JSON file "${fileName}" must contain an array of profiles ` +
                'when reading by testDataName.'
            );
        }

        const profile = profiles.find(
            item => item.testDataName === testDataName
        );

        if (!profile) {
            throw new Error(
                `testDataName "${testDataName}" not found in "${fileName}". ` +
                `Available: ${profiles.map(item => item.testDataName).join(', ')}`
            );
        }

        const row = profile.data?.[rowIndex];

        if (!row) {
            throw new Error(
                `Data row ${rowIndex} not found for testDataName "${testDataName}" ` +
                `in "${fileName}".`
            );
        }

        return row;
    }

    getJsonData<T = Record<string, any>>(fileName: `${string}.json`): T;
    getJsonData<K extends keyof JsonProfileDataMap>(
        testDataName: K
    ): (fileName: string, rowIndex?: number) => JsonProfileDataMap[K];
    getJsonData<T = Record<string, any>>(
        testDataName: string
    ): (fileName: string, rowIndex?: number) => T;
    getJsonData<T = Record<string, any>>(
        value: string
    ): T | ((fileName: string, rowIndex?: number) => T) {
        if (this.isJsonFileName(value)) {
            return this.loadJson<T>(value);
        }

        return (fileName: string, rowIndex = 0): T =>
            this.getJsonProfileRow<T>(value, fileName, rowIndex);
    }

    loadJSON(filePath: string): any {
        const cacheKey = `json_${filePath}`;
        if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);
        const fullPath = path.join(this.dataPath, filePath);
        if (!fs.existsSync(fullPath)) throw new Error(`JSON file not found: ${fullPath}`);
        const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        this.cache.set(cacheKey, data);
        return data;
    }

    // =========================================================================
    // CSV
    // =========================================================================

    loadCSV(filePath: string): string[][] {
        const cacheKey = `csv_${filePath}`;
        if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);
        const fullPath = path.join(this.dataPath, filePath);
        if (!fs.existsSync(fullPath)) throw new Error(`CSV file not found: ${fullPath}`);
        const rows = fs.readFileSync(fullPath, 'utf8').split('\n').map(row => row.split(','));
        this.cache.set(cacheKey, rows);
        return rows;
    }

    // =========================================================================
    // EXCEL — load workbook
    // =========================================================================

    async loadExcel(filePath: string): Promise<ExcelJS.Workbook> {
        const cacheKey = `excel_${filePath}`;
        if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);
        const fullPath = path.join(this.dataPath, filePath);
        if (!fs.existsSync(fullPath)) throw new Error(`Excel file not found: ${fullPath}`);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(fullPath);
        this.cache.set(cacheKey, workbook);
        return workbook;
    }

    // =========================================================================
    // SHEETS
    // =========================================================================

    async getSheetNames(filePath: string): Promise<string[]> {
        const workbook = await this.loadExcel(filePath);
        return workbook.worksheets.map(sheet => sheet.name);
    }

    async getSheetCount(filePath: string): Promise<number> {
        const workbook = await this.loadExcel(filePath);
        return workbook.worksheets.length;
    }

    async sheetExists(filePath: string, sheetName: string): Promise<boolean> {
        const workbook = await this.loadExcel(filePath);
        return !!workbook.getWorksheet(sheetName);
    }

    // =========================================================================
    // ROWS / COLUMNS
    // =========================================================================

    async getRowCount(filePath: string, sheet?: string | number): Promise<number> {
        const workbook = await this.loadExcel(filePath);
        return (await this.resolveSheet(workbook, sheet)).rowCount;
    }

    async getColumnCount(filePath: string, sheet?: string | number): Promise<number> {
        const workbook = await this.loadExcel(filePath);
        return (await this.resolveSheet(workbook, sheet)).columnCount;
    }

    async getRowData(filePath: string, rowNumber: number, sheet?: string | number): Promise<any[]> {
        const workbook = await this.loadExcel(filePath);
        const ws       = await this.resolveSheet(workbook, sheet);
        return (ws.getRow(rowNumber).values as any[]).slice(1);
    }

    async getColumnData(filePath: string, columnNumber: number, sheet?: string | number): Promise<any[]> {
        const workbook = await this.loadExcel(filePath);
        const ws       = await this.resolveSheet(workbook, sheet);
        const data: any[] = [];
        ws.eachRow(row => { data.push(row.getCell(columnNumber).value); });
        return data;
    }

    // =========================================================================
    // CELL
    // =========================================================================

    async getCellValue(filePath: string, row: number, column: number, sheet?: string | number): Promise<any> {
        const workbook = await this.loadExcel(filePath);
        const ws       = await this.resolveSheet(workbook, sheet);
        return ws.getRow(row).getCell(column).value;
    }

    async getFormulaResult(
        filePath: string,
        row: number,
        column: number | string,
        sheet?: string | number
    ): Promise<ExcelFormulaResult> {
        const workbook    = await this.loadExcel(filePath);
        const ws          = await this.resolveSheet(workbook, sheet);
        const columnIndex = typeof column === 'number'
            ? column
            : this.resolveColumnByName(ws, column);
        const value = ws.getRow(row).getCell(columnIndex).value;

        if (value === null || value === undefined) {
            return null;
        }

        if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
        ) {
            return value;
        }

        if (typeof value === 'object' && 'result' in value) {
            const result = value.result;
            if (
                result === null ||
                result === undefined ||
                typeof result === 'string' ||
                typeof result === 'number' ||
                typeof result === 'boolean'
            ) {
                return result ?? null;
            }
        }

        return String(value);
    }

    private resolveColumnByName(ws: ExcelJS.Worksheet, columnName: string): number {
        const headerRow = ws.getRow(1).values as ExcelJS.CellValue[];
        const columnIndex = headerRow.findIndex(
            header => String(header ?? '').trim() === columnName
        );

        if (columnIndex <= 0) {
            throw new Error(`Column "${columnName}" not found in sheet "${ws.name}"`);
        }

        return columnIndex;
    }

    // =========================================================================
    // SHEET DATA
    // =========================================================================

    async getSheetData(filePath: string, sheet?: string | number): Promise<any[][]> {
        const workbook = await this.loadExcel(filePath);
        const ws       = await this.resolveSheet(workbook, sheet);
        const data: any[][] = [];
        ws.eachRow(row => {
            data.push((row.values as any[]).slice(1).map(value => value ?? ''));
        });
        return data;
    }

    async getSheetAsJson(filePath: string, sheet?: string | number): Promise<any[]> {
        const workbook = await this.loadExcel(filePath);
        const ws       = await this.resolveSheet(workbook, sheet);
        const headers  = ws.getRow(1).values as any[];
        const result: any[] = [];
        ws.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const obj: Record<string, any> = {};
            headers.forEach((header, index) => {
                if (!header || index === 0) return;
                obj[String(header)] = row.getCell(index).value;
            });
            result.push(obj);
        });
        return result;
    }

    // =========================================================================
    // GENERIC
    // =========================================================================

    getTestData(dataFile: string, key: string): any {
        return this.loadJSON(dataFile)[key] ?? null;
    }

    getAllTestData(dataFile: string): any {
        return this.loadJSON(dataFile);
    }

    // =========================================================================
    // getTestDataByRow
    // -------------------------------------------------------------------------
    // sheet = name | index | undefined (default = first sheet)
    //
    // await testDataManager.getTestDataByRow('file.xlsx', 2)
    // await testDataManager.getTestDataByRow('file.xlsx', 2, 'LoginTestData')
    // await testDataManager.getTestDataByRow('file.xlsx', 2, 0)
    // =========================================================================

    async getTestDataByRow(
        filePath:  string,
        rowNumber: number,
        sheet?:    string | number
    ): Promise<Record<string, any>> {

        const workbook  = await this.loadExcel(filePath);
        const ws        = await this.resolveSheet(workbook, sheet);
        const headerRow = ws.getRow(1).values as any[];
        const dataRow   = ws.getRow(rowNumber);

        if (!dataRow || dataRow.cellCount === 0) {
            throw new Error(`Row ${rowNumber} not found or empty in sheet "${ws.name}"`);
        }

        const result: Record<string, any> = {};
        headerRow.forEach((header, index) => {
            if (!header || index === 0) return;
            result[String(header)] = dataRow.getCell(index).value ?? '';
        });
        return result;
    }

    // =========================================================================
    // getTestDataByTestCaseId
    // -------------------------------------------------------------------------
    // sheet = name | index | undefined (default = first sheet)
    //
    // await testDataManager.getTestDataByTestCaseId('file.xlsx', 'TC01')
    // await testDataManager.getTestDataByTestCaseId('file.xlsx', 'TC01', 'LoginTestData')
    // await testDataManager.getTestDataByTestCaseId('file.xlsx', 'TC01', 1)
    // await testDataManager.getTestDataByTestCaseId('file.xlsx', 'TC01', 'LoginTestData', 'TC_ID')
    // =========================================================================

    async getTestDataByTestCaseId(
        filePath:    string,
        testCaseId:  string,
        sheet?:      string | number,
        idColumnName = 'TestCaseId'
    ): Promise<Record<string, any>> {

        const workbook      = await this.loadExcel(filePath);
        const ws            = await this.resolveSheet(workbook, sheet);
        const headerRow     = ws.getRow(1).values as any[];
        const idColumnIndex = headerRow.findIndex(
            h => h && String(h).trim() === idColumnName
        );

        if (idColumnIndex === -1) {
            throw new Error(
                `Column "${idColumnName}" not found in sheet "${ws.name}". ` +
                `Available: ${headerRow.filter(Boolean).join(', ')}`
            );
        }

        let matchedRow: Record<string, any> | null = null;

        ws.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const cellValue = String(row.getCell(idColumnIndex).value ?? '').trim();
            if (cellValue === testCaseId) {
                const obj: Record<string, any> = {};
                headerRow.forEach((header, index) => {
                    if (!header || index === 0) return;
                    obj[String(header)] = row.getCell(index).value ?? '';
                });
                matchedRow = obj;
            }
        });

        if (!matchedRow) {
            throw new Error(
                `TestCaseId "${testCaseId}" not found in sheet "${ws.name}" of "${filePath}"`
            );
        }

        return matchedRow;
    }

    // =========================================================================
    // getTestDataByColumnValue
    // -------------------------------------------------------------------------
    // sheet = name | index | undefined (default = first sheet)
    //
    // await testDataManager.getTestDataByColumnValue('file.xlsx', 'Username', 'admin')
    // await testDataManager.getTestDataByColumnValue('file.xlsx', 'Username', 'admin', 'LoginTestData')
    // await testDataManager.getTestDataByColumnValue('file.xlsx', 'Username', 'admin', 2)
    // =========================================================================

    async getTestDataByColumnValue(
        filePath:    string,
        columnName:  string,
        columnValue: string,
        sheet?:      string | number
    ): Promise<Record<string, any>> {

        const workbook  = await this.loadExcel(filePath);
        const ws        = await this.resolveSheet(workbook, sheet);
        const headerRow = ws.getRow(1).values as any[];
        const colIndex  = headerRow.findIndex(h => h && String(h).trim() === columnName);

        if (colIndex === -1) {
            throw new Error(`Column "${columnName}" not found in sheet "${ws.name}"`);
        }

        let matchedRow: Record<string, any> | null = null;

        ws.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const cellValue = String(row.getCell(colIndex).value ?? '').trim();
            if (cellValue === columnValue) {
                const obj: Record<string, any> = {};
                headerRow.forEach((header, index) => {
                    if (!header || index === 0) return;
                    obj[String(header)] = row.getCell(index).value ?? '';
                });
                matchedRow = obj;
            }
        });

        if (!matchedRow) {
            throw new Error(
                `No row found where "${columnName}" = "${columnValue}" in sheet "${ws.name}"`
            );
        }

        return matchedRow;
    }

    // =========================================================================
    // getAllTestDataByTag
    // -------------------------------------------------------------------------
    // sheet = name | index | undefined (default = first sheet)
    //
    // await testDataManager.getAllTestDataByTag('file.xlsx', 'Tag', '@smoke')
    // await testDataManager.getAllTestDataByTag('file.xlsx', 'Tag', '@smoke', 'LoginTestData')
    // await testDataManager.getAllTestDataByTag('file.xlsx', 'Tag', '@smoke', 0)
    // =========================================================================

    async getAllTestDataByTag(
        filePath:   string,
        columnName: string,
        tagValue:   string,
        sheet?:     string | number
    ): Promise<Record<string, any>[]> {

        const workbook  = await this.loadExcel(filePath);
        const ws        = await this.resolveSheet(workbook, sheet);
        const headerRow = ws.getRow(1).values as any[];
        const colIndex  = headerRow.findIndex(h => h && String(h).trim() === columnName);

        if (colIndex === -1) {
            throw new Error(`Column "${columnName}" not found in sheet "${ws.name}"`);
        }

        const results: Record<string, any>[] = [];

        ws.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const cellValue = String(row.getCell(colIndex).value ?? '').trim();
            if (cellValue === tagValue) {
                const obj: Record<string, any> = {};
                headerRow.forEach((header, index) => {
                    if (!header || index === 0) return;
                    obj[String(header)] = row.getCell(index).value ?? '';
                });
                results.push(obj);
            }
        });

        return results;
    }

    // ============================================================================
// JSON PROFILE METHODS
// ============================================================================

getProfileByName(profileName: string): any {

    const profiles = this.loadJSON('test_data_profiles.json');

    return profiles.find(
        (p: any) =>
            p.testDataName === profileName
    );
}

getProfileData(profileName: string): Record<string, any>[] {

    const profile =
        this.getProfileByName(profileName);

    if (!profile) {
        throw new Error(
            `Profile not found: ${profileName}`
        );
    }

    return profile.data ?? [];
}

getProfileRow(
    profileName: string,
    rowIndex: number
): Record<string, any> {

    const rows =
        this.getProfileData(profileName);

    if (rowIndex >= rows.length) {
        throw new Error(
            `Row ${rowIndex} not found in profile ${profileName}`
        );
    }

    return rows[rowIndex];
}

getProfileFirstRow(
    profileName: string
): Record<string, any> {

    return this.getProfileRow(
        profileName,
        0
    );
}

    // =========================================================================
    // CACHE
    // =========================================================================

    clearCache(): void {
        this.cache.clear();
    }
}

export const testDataManager = new TestDataManager();
