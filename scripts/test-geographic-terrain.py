"""合成栅格仅用于验证异常点处理，不作为地图地形数据。"""
import importlib.util
from pathlib import Path
import unittest
import numpy as np

spec=importlib.util.spec_from_file_location('terrain',Path(__file__).with_name('build-geographic-terrain.py'))
terrain=importlib.util.module_from_spec(spec)
spec.loader.exec_module(terrain)

class TerrainTests(unittest.TestCase):
    def test_spikes_and_continuous_negative_basins(self):
        data=np.full((21,21),500,dtype=np.float32)
        data[5,5]=-1800
        data[15,15]=3000
        clean=terrain.remove_isolated_spikes(data)
        self.assertEqual(clean[5,5],500)
        self.assertEqual(clean[15,15],500)
        basin=np.full((21,21),-150,dtype=np.float32)
        np.testing.assert_array_equal(terrain.remove_isolated_spikes(basin),basin)

    def test_continuous_mountain_is_preserved(self):
        x,y=np.meshgrid(np.linspace(-3,3,41),np.linspace(-3,3,41))
        mountain=5000*np.exp(-(x*x+y*y))
        np.testing.assert_array_equal(terrain.remove_isolated_spikes(mountain),mountain)

if __name__=='__main__': unittest.main()
