#!/usr/bin/env python3
"""TradingAgents proxy for Node orchestrator.

Modes:
- If dependencies/keys are unavailable, return structured error (Node adapter falls back).
- If available, run TradingAgentsGraph.propagate() and return normalized insights.
"""
import json
import os
import signal
import sys
from pathlib import Path


def main() -> int:
    if sys.version_info < (3, 10):
        emit({
            'ok': False,
            'error': f'python_too_old:{sys.version_info.major}.{sys.version_info.minor}',
            'required': '>=3.10',
            'hint': 'Install Python 3.10+ and recreate .venv, then reinstall TradingAgents dependencies.'
        })
        return 0

    raw = sys.stdin.read().strip() or '{}'
    payload = json.loads(raw)
    symbol = str(payload.get('symbol', '600519.SH'))
    trade_date = payload.get('trade_date') or os.getenv('TRADE_DATE') or '2026-01-15'

    root = Path('vendors/TradingAgents').resolve()
    if not root.exists():
        emit({'ok': False, 'error': 'vendors/TradingAgents not found'})
        return 0

    sys.path.insert(0, str(root))

    try:
        from tradingagents.graph.trading_graph import TradingAgentsGraph  # type: ignore
        from tradingagents.default_config import DEFAULT_CONFIG  # type: ignore
    except Exception as e:
        emit({'ok': False, 'error': f'import_failed:{e}'})
        return 0

    # Build config from env (minimal + safe defaults)
    config = DEFAULT_CONFIG.copy()
    config['llm_provider'] = os.getenv('TRADINGAGENTS_LLM_PROVIDER', config.get('llm_provider', 'openai'))
    config['deep_think_llm'] = os.getenv('TRADINGAGENTS_DEEP_MODEL', config.get('deep_think_llm', 'gpt-5.2'))
    config['quick_think_llm'] = os.getenv('TRADINGAGENTS_QUICK_MODEL', config.get('quick_think_llm', 'gpt-5-mini'))
    if os.getenv('TRADINGAGENTS_BACKEND_URL'):
        config['backend_url'] = os.getenv('TRADINGAGENTS_BACKEND_URL')
    if os.getenv('TRADINGAGENTS_MAX_DEBATE_ROUNDS'):
        try:
            config['max_debate_rounds'] = int(os.getenv('TRADINGAGENTS_MAX_DEBATE_ROUNDS', '1'))
        except ValueError:
            pass
    if os.getenv('TRADINGAGENTS_MAX_RISK_DISCUSS_ROUNDS'):
        try:
            config['max_risk_discuss_rounds'] = int(os.getenv('TRADINGAGENTS_MAX_RISK_DISCUSS_ROUNDS', '1'))
        except ValueError:
            pass

    # TradingAgents examples use US tickers. For A-share symbols, allow alias via env mapping or fallback raw code.
    company_name = map_symbol_for_tradingagents(symbol)
    selected_analysts = parse_selected_analysts()
    timeout_secs = int(os.getenv('TRADINGAGENTS_PROXY_TIMEOUT_SECS', '45'))

    try:
        ta = TradingAgentsGraph(debug=False, config=config, selected_analysts=selected_analysts)
        final_state, decision = run_with_timeout(lambda: ta.propagate(company_name, trade_date), timeout_secs)
        emit(normalize_result(symbol, company_name, trade_date, final_state, decision))
        return 0
    except Exception as e:
        emit({'ok': False, 'error': f'propagate_failed:{e}', 'symbol': symbol, 'company_name': company_name, 'trade_date': trade_date})
        return 0


def map_symbol_for_tradingagents(symbol: str) -> str:
    # Optional explicit map, e.g. TRADINGAGENTS_SYMBOL_MAP='{"600519.SH":"MOUTAI"}'
    raw_map = os.getenv('TRADINGAGENTS_SYMBOL_MAP', '').strip()
    if raw_map:
        try:
            mapping = json.loads(raw_map)
            if symbol in mapping:
                return str(mapping[symbol])
        except Exception:
            pass

    # Default: convert CN suffixes to yfinance-compatible suffixes where possible.
    upper = symbol.upper()
    if upper.endswith('.SH'):
        return upper.replace('.SH', '.SS')
    if upper.endswith('.SZ'):
        return upper

    # Fallback: strip suffix.
    return symbol.split('.')[0]


def parse_selected_analysts():
    raw = os.getenv('TRADINGAGENTS_SELECTED_ANALYSTS', 'market,news').strip()
    items = [x.strip() for x in raw.split(',') if x.strip()]
    return items or ['market', 'news']


def run_with_timeout(fn, timeout_secs: int):
    if timeout_secs <= 0:
        return fn()

    def _handler(signum, frame):  # noqa: ARG001
        raise TimeoutError(f'tradingagents_proxy_timeout:{timeout_secs}s')

    old_handler = signal.signal(signal.SIGALRM, _handler)
    signal.alarm(timeout_secs)
    try:
        return fn()
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old_handler)


def normalize_result(symbol: str, company_name: str, trade_date: str, final_state, decision):
    fs = final_state if isinstance(final_state, dict) else {}

    market_report = to_text(fs.get('market_report'))
    sentiment_report = to_text(fs.get('sentiment_report'))
    news_report = to_text(fs.get('news_report'))
    fundamentals_report = to_text(fs.get('fundamentals_report'))

    invest_debate = fs.get('investment_debate_state') or {}
    risk_debate = fs.get('risk_debate_state') or {}
    final_decision = fs.get('final_trade_decision') or decision

    return {
        'ok': True,
        'source': 'tradingagents',
        'symbol': symbol,
        'company_name': company_name,
        'trade_date': trade_date,
        'decision': to_text(final_decision),
        'analysts': {
            'market': {'summary': market_report[:1200], 'score': heuristic_score(market_report)},
            'news': {'summary': news_report[:1200], 'score': heuristic_score(news_report)},
            'fundamentals': {'summary': fundamentals_report[:1200], 'score': heuristic_score(fundamentals_report)},
            'social': {'summary': sentiment_report[:1200], 'score': heuristic_score(sentiment_report)},
        },
        'debate': {
            'bull': heuristic_score(to_text((invest_debate or {}).get('bull_history'))),
            'bear': heuristic_score(to_text((invest_debate or {}).get('bear_history')), invert=True),
            'invest_judge': to_text((invest_debate or {}).get('judge_decision'))[:1000],
            'risk_judge': to_text((risk_debate or {}).get('judge_decision'))[:1000],
        },
        'raw': {
            'final_trade_decision': to_text(final_decision)[:2000],
            'investment_judge': to_text((invest_debate or {}).get('judge_decision'))[:2000],
            'risk_judge': to_text((risk_debate or {}).get('judge_decision'))[:2000],
        }
    }


def to_text(value):
    if value is None:
        return ''
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return str(value)


def heuristic_score(text: str, invert: bool = False) -> float:
    text = (text or '').lower()
    positives = ['bull', 'buy', 'positive', 'upside', 'strong', 'good']
    negatives = ['bear', 'sell', 'negative', 'downside', 'weak', 'risk']
    pos = sum(1 for p in positives if p in text)
    neg = sum(1 for n in negatives if n in text)
    score = 0.5 + (pos - neg) * 0.06
    if invert:
        score = 1 - score
    return max(0.0, min(1.0, round(score, 4)))


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False))


if __name__ == '__main__':
    raise SystemExit(main())
