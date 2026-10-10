"""Read actual anonymous Edge PDFs; requires existing pdfplumber runtime."""
from pathlib import Path
import hashlib
import json
import logging
import re
import pdfplumber

logging.getLogger('pdfminer').setLevel(logging.ERROR)
root = Path(__file__).resolve().parent.parent
report = json.loads((root / 'test-results/print-browser-results.json').read_text(encoding='utf-8'))
assert report['anonymous'] and not report['googleRequestsPerformed']
assert len(report['results']) == 5 and all(row['status'] == 'pass' for row in report['results'])
checks = []
for item in report['pdfs']:
    file = (root / item['file']).resolve()
    assert file.is_relative_to(root / 'test-results')
    with pdfplumber.open(file) as pdf:
        texts = [page.extract_text() or '' for page in pdf.pages]
        compact = [re.sub(r'\s+', '', text) for text in texts]
        combined = ''.join(compact)
        assert all(text.strip() for text in texts), 'Unexpected blank page'
        assert all((page.width > page.height) == item['quarter'] for page in pdf.pages), 'Wrong page orientation'
        assert all(abs(max(page.width, page.height) - 841.9) < 2 for page in pdf.pages), 'Expected A4 pages'
        forbidden = ['입금 추가', '완납 처리', '날짜 변경', '금액별 입금 기록 시작', '업무 내용으로 바로 이동']
        assert all(re.sub(r'\s+', '', word) not in combined for word in forbidden), 'Interactive controls reached PDF'
        for key in ['total', 'received', 'unpaid']:
            assert format(item['expected'][key], ',') in combined, 'Expected shared amount missing'
        clipped = []
        for page in pdf.pages:
            clipped.extend(word for word in page.extract_words() if word['x0'] < -1 or word['x1'] > page.width + 1 or word['top'] < -1 or word['bottom'] > page.height + 1)
        assert not clipped, 'Text extends outside the PDF page'
        if item['expected']['receiptEvents']:
            for number in range(1, 25):
                note = re.sub(r'\s+', '', f'출력 검증 기록 {number} · 긴 메모가 다음 줄과 다음 페이지에서도 누락되지 않는지 확인하는 익명 내용입니다.')
                assert sum(note in page for page in compact) == 1, 'Receipt missing, duplicated or split across pages'
            reason = re.sub(r'\s+', '', '출력 검증 정정 사유 · 기존 기록을 남기며 실제 환급을 뜻하지 않습니다.')
            assert sum(reason in page for page in compact) == 1
            assert combined.count('기록정정') == 1, 'Correction buttons or repeated correction record in PDF'
            assert '정정됨' in combined and '과거확인' in combined
        if item['quarter'] and item['expected']['tenantRows']:
            assert item['expected']['tenantRows'] == 36
            for unit in range(201, 237):
                assert combined.count(str(unit) + '호') == 1, 'Quarter tenant missing or duplicated'
            assert '108건' in combined
        if item['name'] == 'quarter-empty':
            assert len(pdf.pages) == 1 and '저장된고지서가없습니다' in combined
        checks.append({'name': item['name'], 'file': item['file'], 'pages': len(pdf.pages), 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'portrait': not item['quarter'], 'noBlankPages': True, 'noInteractiveControls': True, 'amountsMatched': True, 'noOutsidePageText': True, 'completeReceiptNotesOnSinglePages': bool(item['expected']['receiptEvents']), 'status': 'pass'})
result = {'appVersion': report['appVersion'], 'anonymous': True, 'pdfCount': len(checks), 'checks': checks, 'scope': 'Edge-generated PDF text, page dimensions and bounds. Visual rendering reviewed separately; no physical printer or Google execution.'}
(root / 'test-results/print-pdf-validation.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'version': report['appVersion'], 'pdfs': len(checks), 'pages': sum(row['pages'] for row in checks), 'checks': [{'name': row['name'], 'pages': row['pages'], 'status': row['status']} for row in checks]}))
