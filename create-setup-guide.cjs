const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  ExternalHyperlink, LevelFormat, Header, Footer, PageNumber
} = require('docx');
const fs = require('fs');

// ── Colours ──────────────────────────────────────────────────────────────────
const BLUE       = '1F4E8C';
const LIGHT_BLUE = 'D6E4F7';
const GREY_BG    = 'F2F2F2';
const DARK_TEXT  = '1A1A1A';
const GREEN      = '1E7E34';

// ── Helpers ───────────────────────────────────────────────────────────────────
const border  = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border };

function heading1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    children: [new TextRun({ text, bold: true, size: 28, color: BLUE, font: 'Arial' })]
  });
}

function heading2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, bold: true, size: 24, color: '2E5FA3', font: 'Arial' })]
  });
}

function body(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    children: [new TextRun({ text, size: 20, font: 'Arial', color: DARK_TEXT, ...opts })]
  });
}

function bullet(text, bold = false) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { before: 60, after: 60 },
    children: [new TextRun({ text, size: 20, font: 'Arial', bold, color: DARK_TEXT })]
  });
}

function numbered(text) {
  return new Paragraph({
    numbering: { reference: 'numbers', level: 0 },
    spacing: { before: 60, after: 60 },
    children: [new TextRun({ text, size: 20, font: 'Arial', color: DARK_TEXT })]
  });
}

function code(text) {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    indent: { left: 720 },
    children: [new TextRun({ text, size: 18, font: 'Courier New', color: '2E5FA3' })]
  });
}

function note(text) {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    indent: { left: 360 },
    children: [
      new TextRun({ text: 'Note: ', bold: true, size: 20, font: 'Arial', color: GREEN }),
      new TextRun({ text, size: 20, font: 'Arial', color: DARK_TEXT })
    ]
  });
}

function spacer() {
  return new Paragraph({ spacing: { before: 80, after: 80 }, children: [new TextRun('')] });
}

function divider() {
  return new Paragraph({
    spacing: { before: 120, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 1 } },
    children: [new TextRun('')]
  });
}

function link(label, url) {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    children: [
      new ExternalHyperlink({
        link: url,
        children: [new TextRun({ text: label, size: 20, font: 'Arial', style: 'Hyperlink' })]
      })
    ]
  });
}

// ── Tool table ────────────────────────────────────────────────────────────────
const tools = [
  ['run_tests',                      'Run Playwright/Cucumber tests by tag, filter, or scenario name'],
  ['generate_html_report',           'Generate a beautiful shareable HTML test report'],
  ['get_release_risk',               'AI analysis of test failures and release readiness'],
  ['scaffold_project',               'Generate test project boilerplate (hooks, world, config)'],
  ['scan_framework',                 'Scan and remember your test framework structure'],
  ['list_blueprints',                'List available project blueprints'],
  ['requirements_coverage',          'Map requirements to tests and find coverage gaps'],
  ['generate_tests_from_requirements','Auto-generate Gherkin scenarios from requirements docs'],
  ['read_requirements',              'Read and parse requirements documents'],
  ['crawl_page',                     'Crawl a live web page for test data'],
  ['read_db_schema',                 'Introspect database schema for test context'],
];

function toolsTable() {
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        borders, width: { size: 3400, type: WidthType.DXA },
        shading: { fill: BLUE, type: ShadingType.CLEAR },
        margins: { top: 100, bottom: 100, left: 160, right: 160 },
        children: [new Paragraph({ children: [new TextRun({ text: 'Tool Name', bold: true, size: 20, font: 'Arial', color: 'FFFFFF' })] })]
      }),
      new TableCell({
        borders, width: { size: 5960, type: WidthType.DXA },
        shading: { fill: BLUE, type: ShadingType.CLEAR },
        margins: { top: 100, bottom: 100, left: 160, right: 160 },
        children: [new Paragraph({ children: [new TextRun({ text: 'What It Does', bold: true, size: 20, font: 'Arial', color: 'FFFFFF' })] })]
      }),
    ]
  });

  const dataRows = tools.map(([name, desc], i) =>
    new TableRow({
      children: [
        new TableCell({
          borders, width: { size: 3400, type: WidthType.DXA },
          shading: { fill: i % 2 === 0 ? GREY_BG : 'FFFFFF', type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 160, right: 160 },
          children: [new Paragraph({ children: [new TextRun({ text: name, size: 18, font: 'Courier New', color: '2E5FA3' })] })]
        }),
        new TableCell({
          borders, width: { size: 5960, type: WidthType.DXA },
          shading: { fill: i % 2 === 0 ? GREY_BG : 'FFFFFF', type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 160, right: 160 },
          children: [new Paragraph({ children: [new TextRun({ text: desc, size: 20, font: 'Arial', color: DARK_TEXT })] })]
        }),
      ]
    })
  );

  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [3400, 5960],
    rows: [headerRow, ...dataRows]
  });
}

// ── Troubleshooting table ─────────────────────────────────────────────────────
const issues = [
  ['MCP not showing in Claude',    'Restart Claude Desktop completely from the system tray. Also check the JSON syntax in claude_desktop_config.json is valid (no trailing commas).'],
  ['"dist/index.js not found"',    'Run npm run build inside the qa-mcp-server_r folder. Make sure Node.js 18+ is installed.'],
  ['"Project not found" error',    'Double-check the DOTNET_PROJECT_ROOT path in claude_desktop_config.json. Use forward slashes (/) not backslashes.'],
  ['Tests not found / 0 matches',  'Update allowedTags in src/config/environments.ts to match your Cucumber tags, then run npm run build again.'],
];

function troubleshootTable() {
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        borders, width: { size: 3200, type: WidthType.DXA },
        shading: { fill: '8B0000', type: ShadingType.CLEAR },
        margins: { top: 100, bottom: 100, left: 160, right: 160 },
        children: [new Paragraph({ children: [new TextRun({ text: 'Problem', bold: true, size: 20, font: 'Arial', color: 'FFFFFF' })] })]
      }),
      new TableCell({
        borders, width: { size: 6160, type: WidthType.DXA },
        shading: { fill: '8B0000', type: ShadingType.CLEAR },
        margins: { top: 100, bottom: 100, left: 160, right: 160 },
        children: [new Paragraph({ children: [new TextRun({ text: 'Fix', bold: true, size: 20, font: 'Arial', color: 'FFFFFF' })] })]
      }),
    ]
  });

  const dataRows = issues.map(([prob, fix], i) =>
    new TableRow({
      children: [
        new TableCell({
          borders, width: { size: 3200, type: WidthType.DXA },
          shading: { fill: i % 2 === 0 ? 'FFF0F0' : 'FFFFFF', type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 160, right: 160 },
          children: [new Paragraph({ children: [new TextRun({ text: prob, size: 20, font: 'Arial', bold: true, color: '8B0000' })] })]
        }),
        new TableCell({
          borders, width: { size: 6160, type: WidthType.DXA },
          shading: { fill: i % 2 === 0 ? 'FFF0F0' : 'FFFFFF', type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 160, right: 160 },
          children: [new Paragraph({ children: [new TextRun({ text: fix, size: 20, font: 'Arial', color: DARK_TEXT })] })]
        }),
      ]
    })
  );

  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [3200, 6160],
    rows: [headerRow, ...dataRows]
  });
}

// ── Document ──────────────────────────────────────────────────────────────────
const doc = new Document({
  numbering: {
    config: [
      { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: 'numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ]
  },
  styles: {
    default: { document: { run: { font: 'Arial', size: 20 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Arial', color: BLUE },
        paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Arial', color: '2E5FA3' },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BLUE, space: 1 } },
          children: [new TextRun({ text: 'qa-mcp-server  —  Team Setup Guide', bold: true, size: 18, font: 'Arial', color: BLUE })]
        })]
      })
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 1 } },
          children: [
            new TextRun({ text: 'Shared by Ravi Teja Dasi  |  github.com/dasiraviteja04/qa-mcp-server_r  |  Page ', size: 16, font: 'Arial', color: '888888' }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, font: 'Arial', color: '888888' }),
          ]
        })]
      })
    },
    children: [

      // ── Title block ──────────────────────────────────────────────────────────
      new Paragraph({
        spacing: { before: 0, after: 80 },
        children: [new TextRun({ text: 'qa-mcp-server', bold: true, size: 48, font: 'Arial', color: BLUE })]
      }),
      new Paragraph({
        spacing: { before: 0, after: 240 },
        children: [new TextRun({ text: 'Setup Guide for Team Members', size: 28, font: 'Arial', color: '555555' })]
      }),
      divider(),

      // ── Intro ────────────────────────────────────────────────────────────────
      body('qa-mcp-server is an AI-powered QA automation tool that connects to Claude Desktop via the Model Context Protocol (MCP). It lets you run tests, generate reports, analyse failures, scaffold projects, and map requirements — all by chatting with Claude.'),
      spacer(),

      // ── Prerequisites ────────────────────────────────────────────────────────
      heading1('Prerequisites'),
      body('Install the following before starting:'),
      bullet('Node.js 18 or later'),
      new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { before: 60, after: 60 }, children: [
        new TextRun({ text: 'Download: ', size: 20, font: 'Arial' }),
        new ExternalHyperlink({ link: 'https://nodejs.org', children: [new TextRun({ text: 'https://nodejs.org', size: 20, font: 'Arial', style: 'Hyperlink' })] })
      ]}),
      bullet('Git'),
      new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { before: 60, after: 60 }, children: [
        new TextRun({ text: 'Download: ', size: 20, font: 'Arial' }),
        new ExternalHyperlink({ link: 'https://git-scm.com', children: [new TextRun({ text: 'https://git-scm.com', size: 20, font: 'Arial', style: 'Hyperlink' })] })
      ]}),
      bullet('Claude Desktop app'),
      new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { before: 60, after: 60 }, children: [
        new TextRun({ text: 'Download: ', size: 20, font: 'Arial' }),
        new ExternalHyperlink({ link: 'https://claude.ai/download', children: [new TextRun({ text: 'https://claude.ai/download', size: 20, font: 'Arial', style: 'Hyperlink' })] })
      ]}),
      bullet('VS Code (recommended for editing config files)'),
      spacer(),

      // ── Step 1 ───────────────────────────────────────────────────────────────
      heading1('Step 1 — Clone the Repository'),
      body('Open a terminal and run:'),
      code('git clone https://github.com/dasiraviteja04/qa-mcp-server_r.git'),
      code('cd qa-mcp-server_r'),
      spacer(),

      // ── Step 2 ───────────────────────────────────────────────────────────────
      heading1('Step 2 — Install Dependencies & Build'),
      code('npm install'),
      code('npm run build'),
      note('This compiles TypeScript source into the dist/ folder. You should see no errors. If you see errors, make sure Node.js 18+ is installed.'),
      spacer(),

      // ── Step 3 ───────────────────────────────────────────────────────────────
      heading1('Step 3 — Connect to Claude Desktop'),
      body('You need to add qa-mcp-server to your Claude Desktop configuration file.'),
      spacer(),
      heading2('3a. Open the config file'),
      body('The file is located at:'),
      code('C:\\Users\\<your-username>\\AppData\\Roaming\\Claude\\claude_desktop_config.json'),
      body('Quick way to open it:'),
      numbered('Press Win + R on your keyboard'),
      numbered('Type  %APPDATA%\\Claude\\  and press Enter'),
      numbered('Open claude_desktop_config.json in VS Code or Notepad'),
      spacer(),
      heading2('3b. Add the mcpServers section'),
      body('Add the following JSON to the file. If a "preferences" section already exists, add "mcpServers" before it:'),
      code('{'),
      code('  "mcpServers": {'),
      code('    "qa-mcp-server": {'),
      code('      "command": "node",'),
      code('      "args": ["C:/Users/YOUR_USERNAME/qa-mcp-server_r/dist/index.js"],'),
      code('      "env": {'),
      code('        "DOTNET_PROJECT_ROOT": "C:/path/to/your/test/project",'),
      code('        "APP_CODE_ROOT": "C:/path/to/your/app/source/code",'),
      code('        "NODE_ENV": "development"'),
      code('      }'),
      code('    }'),
      code('  }'),
      code('}'),
      spacer(),
      body('Replace the following three values with your own paths:'),
      bullet('YOUR_USERNAME  →  your Windows username (e.g. john.smith)'),
      bullet('DOTNET_PROJECT_ROOT  →  full path to your Playwright/Cucumber test project folder'),
      bullet('APP_CODE_ROOT  →  full path to your application source code (optional but recommended)'),
      note('Use forward slashes (/) in all paths, not backslashes.'),
      spacer(),

      // ── Step 4 ───────────────────────────────────────────────────────────────
      heading1('Step 4 — Restart Claude Desktop'),
      body('After saving the config file, close Claude Desktop completely:'),
      numbered('Right-click the Claude icon in the system tray (bottom-right of your screen)'),
      numbered('Click Quit'),
      numbered('Reopen Claude Desktop from the Start menu'),
      spacer(),

      // ── Step 5 ───────────────────────────────────────────────────────────────
      heading1('Step 5 — Verify the Connection'),
      body('After restarting, verify that qa-mcp-server is connected:'),
      bullet('Look for the MCP plug icon at the bottom of the Claude chat window'),
      bullet('Click it — you should see "qa-mcp-server" listed with all available tools'),
      spacer(),
      body('Or simply type this in Claude:'),
      code('"Use qa-mcp-server and list available tools"'),
      body('If you see a list of tools returned, the setup is complete.'),
      spacer(),

      // ── Step 6 ───────────────────────────────────────────────────────────────
      heading1('Step 6 — Configure Your Project Tags'),
      body('To match your specific test project, update the environments config file:'),
      numbered('Open  src/config/environments.ts  in VS Code'),
      numbered('Update these key fields:'),
      bullet('playwrightProjectRoot  —  path to your test project folder'),
      bullet('allowedTags  —  your Cucumber/Gherkin tags, e.g. [\'my-project\', \'regression\', \'smoke\']'),
      numbered('Save the file and run  npm run build  again'),
      note('Without updating allowedTags, the run_tests tool will not find your tests.'),
      spacer(),

      // ── Available Tools ───────────────────────────────────────────────────────
      heading1('Available Tools'),
      body('Once connected, you have access to the following tools in Claude:'),
      spacer(),
      toolsTable(),
      spacer(),

      // ── Example Usage ─────────────────────────────────────────────────────────
      heading1('Example Usage in Claude'),
      body('Try these prompts in Claude Desktop after setup is complete:'),
      spacer(),
      bullet('"Use qa-mcp-server and run all regression tests"'),
      bullet('"Use qa-mcp-server and run the scenario LoginWithValidCredentials"'),
      bullet('"Use qa-mcp-server and generate an HTML report"'),
      bullet('"Use qa-mcp-server and analyze release risk"'),
      bullet('"Use qa-mcp-server and scaffold a new TypeScript Playwright project"'),
      bullet('"Use qa-mcp-server and show requirements coverage"'),
      spacer(),

      // ── Troubleshooting ────────────────────────────────────────────────────────
      heading1('Troubleshooting'),
      spacer(),
      troubleshootTable(),
      spacer(),

      // ── Footer note ────────────────────────────────────────────────────────────
      divider(),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 160, after: 80 },
        children: [
          new TextRun({ text: 'GitHub Repository: ', size: 18, font: 'Arial', color: '555555' }),
          new ExternalHyperlink({
            link: 'https://github.com/dasiraviteja04/qa-mcp-server_r',
            children: [new TextRun({ text: 'https://github.com/dasiraviteja04/qa-mcp-server_r', size: 18, font: 'Arial', style: 'Hyperlink' })]
          })
        ]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: 'Shared by Ravi Teja Dasi', size: 18, font: 'Arial', color: '888888' })]
      }),
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync('C:/Users/Ravi Teja Dasi/source/repos/qa-mcp-server/qa-mcp-server-setup-guide.docx', buffer);
  console.log('SUCCESS: qa-mcp-server-setup-guide.docx created');
}).catch(err => {
  console.error('ERROR:', err.message);
});
