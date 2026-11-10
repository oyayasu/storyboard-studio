"""Create internal Word-compressed DOCX fixtures for the import UI tests."""
from pathlib import Path
import sys
from docx import Document
from docx.shared import Pt
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.style import WD_STYLE_TYPE
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
def doc(title):
 d=Document();d.styles['Normal'].font.name='Cambria';d.styles['Normal'].font.size=Pt(12);d.add_heading(title,0);return d
def color(run,fill):
 rpr=run._r.get_or_add_rPr();node=OxmlElement('w:shd');node.set(qn('w:fill'),fill);node.set(qn('w:val'),'clear');rpr.append(node)
d=doc('Import sample');d.add_heading('Opening',1);p=d.add_paragraph('Hello, Nora. ');r=p.add_run('[waves]');r.italic=True;color(r,'e4eabf');p.add_run(' The candle is lit.');d.add_heading('A closer look',2);p=d.add_paragraph('Olá 😀 — 猫.');p.add_run().add_break();p.add_run('Look\tclosely.');d.add_heading('Later',1);d.add_heading('Ending',1);d.add_paragraph('They walk home.');d.save(out/'outline.docx')
d=doc('Match sample');style=d.styles.add_style('Scene Header',WD_STYLE_TYPE.PARAGRAPH);style.base_style=d.styles['Heading 1'];d.add_paragraph('Existing opening',style='Scene Header');p=d.add_paragraph('Spoken ');p.add_run('bold narration').bold=True;r=p.add_run(' [whisper]');r.italic=True;r.bold=True;color(r,'f0d4db');d.add_heading('Existing detail',2);d.add_paragraph('More words.');d.add_heading('New ending',1);d.add_paragraph('Goodbye.');d.save(out/'matching.docx')
d=doc('Plain script');d.add_paragraph('A document without chapter headings.');d.add_paragraph('Everything belongs to one chapter.');d.save(out/'plain.docx')
d=doc('Orphan heading');d.add_heading('Missing parent',2);d.add_paragraph('This file must not change the project.');d.save(out/'orphan.docx')
print('Created four DOCX import fixtures in',out)
