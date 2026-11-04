import { InvalidMenuItemNameError, MenuItemName } from '..';

describe('MenuItemName', () => {
  it('aceita um nome válido', () => {
    expect(MenuItemName.from('Eletrodomésticos').value).toBe('Eletrodomésticos');
  });

  it('remove espaços nas pontas e colapsa espaços internos', () => {
    expect(MenuItemName.from('  Linha   Branca \n').value).toBe('Linha Branca');
  });

  it.each([undefined, null, 10, {}, ''])('rejeita o valor inválido %p', (value) => {
    expect(() => MenuItemName.from(value)).toThrow(InvalidMenuItemNameError);
  });

  it('rejeita nome só com espaços', () => {
    expect(() => MenuItemName.from('   ')).toThrow(InvalidMenuItemNameError);
  });

  it('respeita o tamanho máximo', () => {
    const max = 'a'.repeat(MenuItemName.MAX_LENGTH);

    expect(MenuItemName.from(max).value).toBe(max);
    expect(() => MenuItemName.from(`${max}a`)).toThrow(InvalidMenuItemNameError);
  });

  it('compara pelo valor normalizado', () => {
    expect(MenuItemName.from(' Informática ').equals(MenuItemName.from('Informática'))).toBe(true);
  });
});
